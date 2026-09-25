package com.acttub.actingapi.feature.practice.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticeRepository;
import com.acttub.actingapi.feature.practice.app.PracticeSessionRepository;
import com.acttub.actingapi.feature.practice.app.PracticeViews.GroupView;
import com.acttub.actingapi.feature.practice.app.PracticeViews.JobView;
import com.acttub.actingapi.feature.practice.app.PracticeViews.PracticeView;
import com.acttub.actingapi.feature.practice.app.PracticeViews.StatusView;
import com.acttub.actingapi.feature.practice.app.PracticeViews.AnalysisView;
import com.acttub.actingapi.feature.practice.domain.ObservationPack;
import com.acttub.actingapi.integration.observation.VideoRecord;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 1.0.0 회차·묶음과 분석 작업의 저장소.
 *
 * <p><b>잠그는 순서가 규칙을 세운다.</b> 시작은 <b>영상 행</b>을 잡고(보관함의 삭제·파기가 같은 행을 잡으므로
 * "회차 시작과 영상 삭제가 동시: 하나만 성공"이 선다), 이어하기·재시도는 <b>묶음의 첫 행</b>을 잡는다(서로 다른
 * 요청 id 로 겹쳐 온 이어하기 가운데 하나만 차수를 받는다). 게스트의 하루 한도는 <b>사용자 행</b>을 잡고 센다.
 *
 * <p>회차와 작업은 한 트랜잭션이다 — 도중에 실패하면 둘 다 없다.
 */
@Repository
class PostgresPracticeRepository implements PracticeRepository {
    /**
     * 회차 한 줄을 만드는 SELECT — 상세·목록·응답이 모두 이 모양을 쓴다.
     *
     * <p>작업은 <b>열린 것(pending·running)을 먼저</b> 고르고 없으면 마지막 것을 고른다. 화면이 보고 싶은 것은
     * "지금 도는 작업"이고, 재시도가 같은 시각에 걸리면 시각만으로는 새 작업과 옛 작업이 갈리지 않는다.
     */
    private static final String PRACTICE_COLUMNS = """
            SELECT p.id,p.root_id,p.ordinal,p.video_id,p.stage,p.close_reason,p.experience_version,
                   p.situation,p.character_context,p.goal,p.blockage_kind,p.sub_branch,p.blockage_detail,
                   p.created_at,
                   a.status AS analysis_status,
                   c.id AS conversation_id,c.status AS conversation_status,
                   (SELECT count(*) FROM coach_messages m WHERE m.conversation_id=c.id) AS conversation_count,
                   n.id AS note_id,n.title AS note_title,n.kind AS note_kind,
                   j.id AS job_id,j.status AS job_status,j.failure_reason,j.attempt_count
            FROM practices p
            LEFT JOIN analyses a ON a.practice_id=p.id
            LEFT JOIN coach_conversations c ON c.practice_id=p.id
            LEFT JOIN coach_notes n ON n.conversation_id=c.id
            LEFT JOIN LATERAL (SELECT id,status,failure_reason,attempt_count
                               FROM ai_jobs
                               WHERE target_id=p.id AND kind='analyze'
                               ORDER BY (status IN ('pending','running')) DESC,created_at DESC,id DESC
                               LIMIT 1) j ON true
            """;

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final ObjectMapper mapper;
    private final PracticeSessionRepository legacySessions;

    PostgresPracticeRepository(EntityManager entityManager, PlatformTransactionManager transactionManager,
                               ObjectMapper mapper, PracticeSessionRepository legacySessions) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.mapper = mapper;
        this.legacySessions = legacySessions;
    }

    @Override
    public AnalysisView analysis(UUID userId, UUID practiceId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT a.id,a.format,a.status,CAST(a.record AS text) AS record
                FROM analyses a JOIN practices p ON p.id=a.practice_id
                WHERE p.id=:id AND p.user_id=:userId
                """, Tuple.class).setParameter("id", practiceId).setParameter("userId", userId));
        if (rows.isEmpty()) {
            var legacy = legacySessions.detail(userId, practiceId);
            if (legacy == null) return null;
            if (legacy.videoRecord() != null) {
                return new AnalysisView(legacy.videoRecord().recordId(), "video_record_v1",
                        legacy.videoRecord().status(), null, legacy.videoRecord());
            }
            return legacy.summary() == null ? null : new AnalysisView(legacy.summary().summaryId(),
                    "legacy", "ready", legacy.summary(), null);
        }
        Tuple row = rows.getFirst();
        try {
            var record = mapper.readTree(row.get("record", String.class));
            UUID id = row.get("id", UUID.class);
            boolean structured = VideoRecord.isRecord(record);
            return new AnalysisView(id, row.get("format", String.class), row.get("status", String.class),
                    structured ? null : new ObservationPack(id,
                            PracticeAnalysisMapper.observations(record.path("observations")),
                            PracticeAnalysisMapper.uncertainties(record.path("uncertainties"))),
                    structured ? PracticeAnalysisMapper.recordSummary(record) : null);
        } catch (JsonProcessingException failure) {
            throw new IllegalStateException("practice analysis contains invalid JSON", failure);
        }
    }

    @Override
    public Started start(UUID userId, NewPractice practice, Quota quota, Instant now) {
        return transaction.execute(tx -> {
            Started replayed = replay(userId, practice);
            if (replayed != null) {
                return replayed;
            }
            if (!lockUsableVideo(userId, practice.videoId())) {
                return new Started(StartOutcome.VIDEO_NOT_READY, null);
            }
            if (overQuota(userId, quota)) {
                return new Started(StartOutcome.QUOTA, null);
            }
            UUID id = UUID.randomUUID();
            insertPractice(id, id, 1, userId, practice, now);
            insertAnalyzeJob(userId, id, practice.requestId(), practice.fingerprint(), now);
            return new Started(StartOutcome.CREATED, find(userId, id));
        });
    }

    @Override
    public Started continueGroup(UUID userId, UUID from, UUID videoId, NewPractice practice, Quota quota, Instant now) {
        return transaction.execute(tx -> {
            Started replayed = replay(userId, practice);
            if (replayed != null) {
                return replayed;
            }
            List<Tuple> source = NativeTuples.list(entityManager.createNativeQuery(
                    "SELECT root_id,video_id FROM practices WHERE id=:from AND user_id=:userId", Tuple.class)
                    .setParameter("from", from)
                    .setParameter("userId", userId));
            if (source.isEmpty()) {
                return new Started(StartOutcome.NOT_FOUND, null);
            }
            UUID rootId = source.getFirst().get("root_id", UUID.class);
            lockGroup(rootId);
            if (openPracticeOf(rootId) != null) {
                return new Started(StartOutcome.IN_PROGRESS, null);
            }
            UUID video = videoId == null ? source.getFirst().get("video_id", UUID.class) : videoId;
            if (!lockUsableVideo(userId, video)) {
                return new Started(StartOutcome.VIDEO_NOT_READY, null);
            }
            if (overQuota(userId, quota)) {
                return new Started(StartOutcome.QUOTA, null);
            }
            UUID id = UUID.randomUUID();
            int ordinal = 1 + ((Number) entityManager.createNativeQuery(
                    "SELECT COALESCE(max(ordinal),0) AS last FROM practices WHERE root_id=:rootId")
                    .setParameter("rootId", rootId)
                    .getSingleResult()).intValue();
            insertPractice(id, rootId, ordinal, userId,
                    new NewPractice(practice.requestId(), practice.fingerprint(), video, practice.experienceVersion(),
                            practice.situation(), practice.characterContext(), practice.goal(),
                            practice.blockageKind(), practice.subBranch(), practice.blockageNote()),
                    now);
            insertAnalyzeJob(userId, id, practice.requestId(), practice.fingerprint(), now);
            return new Started(StartOutcome.CREATED, find(userId, id));
        });
    }

    @Override
    public Started retryAnalysis(
            UUID userId, UUID practiceId, UUID requestId, String fingerprint, Quota quota, Instant now) {
        return transaction.execute(tx -> {
            List<Tuple> existing = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT p.id
                    FROM ai_jobs j
                    JOIN practices p ON p.id=j.target_id
                    WHERE j.user_id=:userId
                      AND j.request_id=:requestId
                    """, Tuple.class)
                    .setParameter("userId", userId)
                    .setParameter("requestId", requestId));
            if (!existing.isEmpty()) {
                return new Started(StartOutcome.REPLAYED, find(userId, existing.getFirst().get("id", UUID.class)));
            }
            List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery(
                    "SELECT root_id,stage FROM practices WHERE id=:practiceId AND user_id=:userId", Tuple.class)
                    .setParameter("practiceId", practiceId)
                    .setParameter("userId", userId));
            if (rows.isEmpty()) {
                return new Started(StartOutcome.NOT_FOUND, null);
            }
            UUID rootId = rows.getFirst().get("root_id", UUID.class);
            lockGroup(rootId);
            if (!"closed".equals(currentStage(practiceId))) {
                return new Started(StartOutcome.NOT_FAILED, null);
            }
            UUID open = openPracticeOf(rootId);
            if (open != null) {
                return new Started(StartOutcome.IN_PROGRESS, null);
            }
            if (overQuota(userId, quota)) {
                return new Started(StartOutcome.QUOTA, null);
            }
            entityManager.createNativeQuery("""
                    UPDATE practices
                    SET stage='analyzing',close_reason=NULL,updated_at=:now
                    WHERE id=:practiceId
                    """)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("practiceId", practiceId)
                    .executeUpdate();
            insertAnalyzeJob(userId, practiceId, requestId, fingerprint, now);
            return new Started(StartOutcome.CREATED, find(userId, practiceId));
        });
    }

    @Override
    public PracticeView find(UUID userId, UUID practiceId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery(
                PRACTICE_COLUMNS + "WHERE p.id=:practiceId AND p.user_id=:userId", Tuple.class)
                .setParameter("practiceId", practiceId)
                .setParameter("userId", userId));
        return rows.isEmpty() ? null : view(rows.getFirst());
    }

    @Override
    public StatusView status(UUID userId, UUID practiceId) {
        PracticeView view = find(userId, practiceId);
        return view == null
                ? null
                : new StatusView(view.stage(), view.closeReason(), view.analysisStatus(), view.job());
    }

    @Override
    public List<GroupView> groups(UUID userId, String filter, Instant now) {
        StringBuilder where = new StringBuilder("""
                WHERE p.user_id=:userId
                  AND root.hidden_at IS NULL
                  AND p.legacy_hidden_at IS NULL
                """);
        if ("favorite".equals(filter)) {
            where.append("  AND root.favorite=true\n");
        }
        if ("recent30".equals(filter)) {
            where.append("  AND p.created_at>=:since\n");
        }
        var query = entityManager.createNativeQuery("""
                SELECT p.id,p.root_id,p.ordinal,p.video_id,p.stage,p.close_reason,p.experience_version,
                       p.situation,p.character_context,p.goal,p.blockage_kind,p.sub_branch,p.blockage_detail,
                       p.created_at,
                       a.status AS analysis_status,
                       c.id AS conversation_id,c.status AS conversation_status,
                       (SELECT count(*) FROM coach_messages m WHERE m.conversation_id=c.id) AS conversation_count,
                       n.id AS note_id,n.title AS note_title,n.kind AS note_kind,
                       j.id AS job_id,j.status AS job_status,j.failure_reason,j.attempt_count,
                       root.title AS group_title,root.tags AS group_tags,root.favorite AS group_favorite,
                       root.hidden_at AS group_hidden_at,
                       (SELECT max(gc.updated_at)
                        FROM coach_conversations gc
                        JOIN practices gp ON gp.id=gc.practice_id
                        WHERE gp.root_id=p.root_id) AS last_conversation_at
                FROM practices p
                JOIN practices root ON root.id=p.root_id
                LEFT JOIN analyses a ON a.practice_id=p.id
                LEFT JOIN coach_conversations c ON c.practice_id=p.id
                LEFT JOIN coach_notes n ON n.conversation_id=c.id
                LEFT JOIN LATERAL (SELECT id,status,failure_reason,attempt_count
                                   FROM ai_jobs
                                   WHERE target_id=p.id AND kind='analyze'
                                   ORDER BY (status IN ('pending','running')) DESC,created_at DESC,id DESC
                                   LIMIT 1) j ON true
                """ + where + """
                ORDER BY root.created_at DESC,root.id DESC,p.ordinal
                """, Tuple.class)
                .setParameter("userId", userId);
        if ("recent30".equals(filter)) {
            query.setParameter("since", now.minus(java.time.Duration.ofDays(30)).atOffset(ZoneOffset.UTC));
        }
        Map<UUID, List<Tuple>> byRoot = new LinkedHashMap<>();
        for (Tuple row : NativeTuples.list(query)) {
            byRoot.computeIfAbsent(row.get("root_id", UUID.class), key -> new ArrayList<>()).add(row);
        }
        List<GroupView> groups = new ArrayList<>();
        byRoot.forEach((rootId, rows) -> {
            List<PracticeView> practices = rows.stream().map(PostgresPracticeRepository::view).toList();
            Tuple first = rows.getFirst();
            groups.add(new GroupView(
                    rootId,
                    first.get("group_title", String.class),
                    practices.size(),
                    first.get("last_conversation_at", Instant.class),
                    tags(first.get("group_tags", String.class)),
                    first.get("group_favorite", Boolean.class),
                    first.get("group_hidden_at", Instant.class),
                    practices.stream().filter(p -> !"closed".equals(p.stage())).map(PracticeView::id).findFirst().orElse(null),
                    practices));
        });
        return List.copyOf(groups);
    }

    @Override
    public Cancelled cancel(UUID userId, UUID practiceId, Instant now) {
        return transaction.execute(tx -> {
            List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery(
                    "SELECT stage FROM practices WHERE id=:practiceId AND user_id=:userId FOR UPDATE", Tuple.class)
                    .setParameter("practiceId", practiceId)
                    .setParameter("userId", userId));
            if (rows.isEmpty()) {
                return new Cancelled(CancelOutcome.NOT_FOUND, null);
            }
            // lease 를 지운다 — 돌고 있던 워커의 늦은 완료와 재큐가 받아들여지지 않는다(CONTRACT §5-7).
            int closed = entityManager.createNativeQuery("""
                    UPDATE ai_jobs
                    SET status='failed',failure_reason='cancelled',
                        lease_token=NULL,lease_expires_at=NULL,updated_at=:now
                    WHERE target_id=:practiceId
                      AND kind='analyze'
                      AND status IN ('pending','running')
                    """)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("practiceId", practiceId)
                    .executeUpdate();
            if (closed == 0) {
                return new Cancelled(CancelOutcome.ALREADY_DONE, null);
            }
            entityManager.createNativeQuery("""
                    UPDATE practices
                    SET stage='closed',close_reason='cancelled',updated_at=:now
                    WHERE id=:practiceId
                    """)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("practiceId", practiceId)
                    .executeUpdate();
            return new Cancelled(CancelOutcome.CANCELLED, status(userId, practiceId));
        });
    }

    @Override
    public GroupView updateGroup(
            UUID userId, UUID rootId, Boolean favorite, Boolean hidden, String title, Instant now) {
        return transaction.execute(tx -> {
            List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT id FROM practices
                    WHERE id=:rootId AND user_id=:userId AND root_id=:rootId
                    FOR UPDATE
                    """, Tuple.class)
                    .setParameter("rootId", rootId)
                    .setParameter("userId", userId));
            if (rows.isEmpty()) {
                return null;
            }
            entityManager.createNativeQuery("""
                    UPDATE practices
                    SET favorite=COALESCE(CAST(:favorite AS boolean),favorite),
                        hidden_at=CASE WHEN CAST(:hidden AS boolean) IS NULL THEN hidden_at
                                       WHEN CAST(:hidden AS boolean) THEN COALESCE(hidden_at,:now)
                                       ELSE NULL END,
                        title=COALESCE(CAST(:title AS text),title),
                        updated_at=:now
                    WHERE id=:rootId
                    """)
                    .setParameter("favorite", favorite)
                    .setParameter("hidden", hidden)
                    .setParameter("title", title)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("rootId", rootId)
                    .executeUpdate();
            return group(userId, rootId);
        });
    }

    /** 숨김·필터와 무관하게 묶음 하나를 읽는다 — 방금 숨긴 묶음도 돌려줘야 한다. */
    private GroupView group(UUID userId, UUID rootId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery(
                PRACTICE_COLUMNS + "WHERE p.root_id=:rootId AND p.user_id=:userId ORDER BY p.ordinal", Tuple.class)
                .setParameter("rootId", rootId)
                .setParameter("userId", userId));
        if (rows.isEmpty()) {
            return null;
        }
        List<Tuple> rootRow = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT title,tags,favorite,hidden_at,
                       (SELECT max(gc.updated_at)
                        FROM coach_conversations gc
                        JOIN practices gp ON gp.id=gc.practice_id
                        WHERE gp.root_id=:rootId) AS last_conversation_at
                FROM practices WHERE id=:rootId
                """, Tuple.class)
                .setParameter("rootId", rootId));
        Tuple root = rootRow.getFirst();
        List<PracticeView> practices = rows.stream().map(PostgresPracticeRepository::view).toList();
        return new GroupView(
                rootId,
                root.get("title", String.class),
                practices.size(),
                root.get("last_conversation_at", Instant.class),
                tags(root.get("tags", String.class)),
                root.get("favorite", Boolean.class),
                root.get("hidden_at", Instant.class),
                practices.stream().filter(p -> !"closed".equals(p.stage())).map(PracticeView::id).findFirst().orElse(null),
                practices);
    }

    /** 같은 요청 id 가 이미 만든 회차. 지문이 다르면 {@link StartOutcome#FINGERPRINT_MISMATCH}. */
    private Started replay(UUID userId, NewPractice practice) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT id,request_fingerprint
                FROM practices
                WHERE user_id=:userId AND request_id=:requestId
                """, Tuple.class)
                .setParameter("userId", userId)
                .setParameter("requestId", practice.requestId()));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        String stored = row.get("request_fingerprint", String.class);
        if (stored != null && !practice.fingerprint().equals(stored.strip())) {
            return new Started(StartOutcome.FINGERPRINT_MISMATCH, null);
        }
        return new Started(StartOutcome.REPLAYED, find(userId, row.get("id", UUID.class)));
    }

    /**
     * 보관함의 영상 행을 잡는다 — 삭제·파기가 같은 행을 잡으므로 겹쳐도 하나만 성공한다. 없거나 남의 것이거나
     * 파일이 파기됐으면 거짓이다.
     */
    private boolean lockUsableVideo(UUID userId, UUID videoId) {
        if (videoId == null) {
            return false;
        }
        return !NativeTuples.list(entityManager.createNativeQuery("""
                SELECT id FROM videos
                WHERE id=:videoId AND user_id=:userId AND purged_at IS NULL
                FOR UPDATE
                """, Tuple.class)
                .setParameter("videoId", videoId)
                .setParameter("userId", userId)).isEmpty();
    }

    /** 묶음의 첫 행을 잡는다 — 겹쳐 온 이어하기·재시도가 여기서 줄을 선다. */
    private void lockGroup(UUID rootId) {
        NativeTuples.list(entityManager.createNativeQuery(
                "SELECT id FROM practices WHERE id=:rootId FOR UPDATE", Tuple.class)
                .setParameter("rootId", rootId));
    }

    /** 묶음에 닫히지 않은 회차. 없으면 {@code null}. */
    private UUID openPracticeOf(UUID rootId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT id FROM practices
                WHERE root_id=:rootId AND stage<>'closed'
                ORDER BY ordinal
                LIMIT 1
                """, Tuple.class)
                .setParameter("rootId", rootId));
        return rows.isEmpty() ? null : rows.getFirst().get("id", UUID.class);
    }

    private String currentStage(UUID practiceId) {
        return (String) entityManager.createNativeQuery("SELECT stage FROM practices WHERE id=:practiceId")
                .setParameter("practiceId", practiceId)
                .getSingleResult();
    }

    /**
     * 게스트의 하루 분석 요청 수. 사용자 행을 잡고 센다 — 겹쳐 온 시작이 함께 한도를 넘지 못한다. 옛 흐름
     * ({@code external_operations})의 요청도 같은 하루에 든다: 두 흐름이 공존하는 동안 배우에게는 한 계정의
     * 하루다.
     */
    private boolean overQuota(UUID userId, Quota quota) {
        if (quota == null) {
            return false;
        }
        NativeTuples.list(entityManager.createNativeQuery(
                "SELECT id FROM users WHERE id=:userId FOR UPDATE", Tuple.class)
                .setParameter("userId", userId));
        Number requested = (Number) entityManager.createNativeQuery("""
                SELECT (SELECT count(*) FROM ai_jobs
                        WHERE user_id=:userId AND kind='analyze' AND created_at>=:since)
                     + (SELECT count(*) FROM external_operations
                        WHERE user_id=:userId AND kind='analyze' AND created_at>=:since) AS requested
                """)
                .setParameter("userId", userId)
                .setParameter("since", quota.since().atOffset(ZoneOffset.UTC))
                .getSingleResult();
        return requested.intValue() >= quota.limit();
    }

    private void insertPractice(UUID id, UUID rootId, int ordinal, UUID userId, NewPractice practice, Instant now) {
        entityManager.createNativeQuery("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,request_id,
                                      request_fingerprint,situation,character_context,goal,blockage_kind,sub_branch,
                                      blockage_detail,created_at,updated_at)
                VALUES (:id,:userId,:videoId,:rootId,:ordinal,'analyzing',:experienceVersion,:requestId,:fingerprint,
                        :situation,:characterContext,:goal,:blockageKind,:subBranch,:blockageNote,:now,:now)
                """)
                .setParameter("id", id)
                .setParameter("userId", userId)
                .setParameter("videoId", practice.videoId())
                .setParameter("rootId", rootId)
                .setParameter("ordinal", ordinal)
                .setParameter("experienceVersion", practice.experienceVersion())
                .setParameter("requestId", practice.requestId())
                .setParameter("fingerprint", practice.fingerprint())
                .setParameter("situation", practice.situation())
                .setParameter("characterContext", practice.characterContext())
                .setParameter("goal", practice.goal())
                .setParameter("blockageKind", practice.blockageKind())
                .setParameter("subBranch", practice.subBranch())
                .setParameter("blockageNote", practice.blockageNote())
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .executeUpdate();
    }

    /** 분석 작업 하나. 회차를 만든 트랜잭션 안이라 둘은 함께 생기거나 함께 없다. */
    private void insertAnalyzeJob(UUID userId, UUID practiceId, UUID requestId, String fingerprint, Instant now) {
        entityManager.createNativeQuery("""
                INSERT INTO ai_jobs(id,user_id,kind,target_id,request_id,request_fingerprint,status,created_at,updated_at)
                VALUES (:id,:userId,'analyze',:targetId,:requestId,:fingerprint,'pending',:now,:now)
                """)
                .setParameter("id", UUID.randomUUID())
                .setParameter("userId", userId)
                .setParameter("targetId", practiceId)
                .setParameter("requestId", requestId)
                .setParameter("fingerprint", fingerprint)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .executeUpdate();
    }

    private static List<String> tags(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        try {
            return List.copyOf(new com.fasterxml.jackson.databind.ObjectMapper()
                    .readValue(raw, new com.fasterxml.jackson.core.type.TypeReference<List<String>>() { }));
        } catch (Exception unreadable) {
            return List.of();
        }
    }

    private static PracticeView view(Tuple row) {
        UUID jobId = row.get("job_id", UUID.class);
        return new PracticeView(
                row.get("id", UUID.class),
                row.get("root_id", UUID.class),
                row.get("ordinal", Integer.class),
                row.get("video_id", UUID.class),
                row.get("stage", String.class),
                row.get("close_reason", String.class),
                row.get("experience_version", String.class),
                row.get("situation", String.class),
                row.get("character_context", String.class),
                row.get("goal", String.class),
                row.get("blockage_kind", String.class),
                row.get("sub_branch", String.class),
                row.get("blockage_detail", String.class),
                row.get("created_at", Instant.class),
                row.get("analysis_status", String.class),
                row.get("conversation_id", UUID.class),
                row.get("conversation_status", String.class),
                ((Number) row.get("conversation_count")).intValue(),
                row.get("note_id", UUID.class),
                row.get("note_title", String.class),
                row.get("note_kind", String.class),
                jobId == null
                        ? null
                        : new JobView(
                                jobId,
                                row.get("job_status", String.class),
                                row.get("failure_reason", String.class),
                                row.get("attempt_count", Integer.class)),
                // 새 표는 회차당 대화 하나다 — 이전 대화는 옛 자료를 읽는 호환 경로에서만 나온다.
                List.of());
    }
}
