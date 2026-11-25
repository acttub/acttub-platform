package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.AiReportRepository;
import com.acttub.actingapi.feature.challenge.domain.ChallengeReportRules;
import com.acttub.actingapi.feature.challenge.domain.ChallengeRules;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.schema.EntryAiReportStatus;
import com.acttub.actingapi.platform.web.ApiException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import tools.jackson.databind.node.ObjectNode;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import com.acttub.actingapi.platform.json.LenientJson;
import tools.jackson.databind.json.JsonMapper;

/**
 * 챌린지 AI 리포트 (challenge.ai-report). 표본 조건은 공개 조건 + 요청자와 차단 없음 + 다른 작성자이고, 작성자당 가장
 * 최근 공개 참여작 하나씩 최근 다섯이다. 저장 직전과 조회 때 이 조건을 다시 봐서 부적격이 된 표본에 기댄 견주기 문장을
 * 뺀다. 표본 id 는 응답에 싣지 않는다.
 */
@Repository
class PostgresAiReportRepository implements AiReportRepository {
    private static final String KIND = com.acttub.actingapi.platform.schema.AiJobKind.CHALLENGE_REPORT.dbValue();
    private final EntityManager em;
    private final ChallengeEntryJpaRepository entries;
    private final EntryAiReportJpaRepository reports;
    private final EntryLocks locks;
    private final AiJobLedger ledger;
    private final NotificationEvents events;
    private final ObjectMapper json = JsonMapper.builderWithJackson2Defaults().build();

    PostgresAiReportRepository(EntityManager em, ChallengeEntryJpaRepository entries, EntryAiReportJpaRepository reports,
                               EntryLocks locks, AiJobLedger ledger, NotificationEvents events) {
        this.em = em; this.entries = entries; this.reports = reports; this.locks = locks; this.ledger = ledger; this.events = events;
    }

    @Override @Transactional
    public Requested request(UUID owner, UUID entryId, UUID requestId, String fingerprint, Instant now) {
        locks.people(owner, owner, false);
        var replay = NativeTuples.list(em.createNativeQuery(
                "SELECT kind,target_id,request_fingerprint FROM ai_jobs WHERE user_id=:owner AND request_id=:request", Tuple.class)
                .setParameter("owner", owner).setParameter("request", requestId));
        if (!replay.isEmpty()) {
            Tuple job = replay.getFirst();
            if (!KIND.equals(job.get("kind", String.class)) || !fingerprint.equals(job.get("request_fingerprint", String.class).strip())) {
                throw new ApiException(422, "request_fingerprint_mismatch");
            }
            return new Requested(find(owner, entryId), false);
        }
        // 참여작 행을 잡는다 — 같은 참여작의 동시 요청과 삭제가 여기서 줄을 선다.
        var entry = NativeTuples.list(em.createNativeQuery("""
                SELECT e.video_id,v.purged_at FROM challenge_entries e LEFT JOIN videos v ON v.id=e.video_id
                WHERE e.id=:id AND e.user_id=:owner AND e.status<>'deleted' FOR UPDATE OF e
                """, Tuple.class).setParameter("id", entryId).setParameter("owner", owner));
        if (entry.isEmpty()) throw new ApiException(404, "entry_not_found");
        if (entry.getFirst().get("video_id") == null || entry.getFirst().get("purged_at") != null) {
            throw new ApiException(422, "video_not_ready");
        }
        var existing = reports.lockStatus(entryId);
        // 결과가 있거나 만드는 중이면 그것이다 — 참여작당 실행 중인 생성은 하나다.
        if (existing.isPresent() && existing.get() != EntryAiReportStatus.FAILED) {
            return new Requested(find(owner, entryId), false);
        }
        Instant midnight = ChallengeRules.koreanMidnight(now);
        long today = ((Number) em.createNativeQuery(
                "SELECT count(*) FROM ai_jobs WHERE user_id=:owner AND kind='challenge_report' AND created_at>=:since")
                .setParameter("owner", owner).setParameter("since", midnight.atOffset(ZoneOffset.UTC)).getSingleResult()).longValue();
        if (today >= ChallengeReportRules.DAILY_REQUESTS) throw new ApiException(429, "daily_report_request_limit");
        UUID job = UUID.randomUUID();
        em.createNativeQuery("""
                INSERT INTO ai_jobs(id,user_id,kind,target_id,request_id,request_fingerprint,status,attempt_count,created_at,updated_at)
                VALUES (:id,:owner,'challenge_report',:entry,:request,:fingerprint,'pending',0,:now,:now)
                """).setParameter("id", job).setParameter("owner", owner).setParameter("entry", entryId)
                .setParameter("request", requestId).setParameter("fingerprint", fingerprint)
                .setParameter("now", now.atOffset(ZoneOffset.UTC)).executeUpdate();
        reports.start(UUID.randomUUID(), entryId, owner, job, EntryAiReportStatus.PENDING, ChallengeReportRules.FORMAT_VERSION, now);
        return new Requested(find(owner, entryId), true);
    }

    @Override @Transactional(readOnly = true)
    public Report find(UUID owner, UUID entryId) {
        var row = reports.findOwned(entryId, owner).orElseThrow(() -> new ApiException(404, "ai_report_not_found"));
        var observations = new ArrayList<Evidence>();
        var comparisons = new ArrayList<String>();
        var limits = new ArrayList<String>();
        String suggestion = null;
        int sampleCount = 0;
        JsonNode result = row.result();
        if (result != null) {
            result.path("observations").forEach(item -> observations.add(new Evidence(LenientJson.asInt(item.path("start_ms")),
                    LenientJson.asInt(item.path("end_ms")), LenientJson.asText(item.path("text")))));
            Set<UUID> eligible = eligible(owner, ids(result.path("samples")));
            sampleCount = eligible.size();
            for (JsonNode item : result.path("comparisons")) {
                if (eligible.containsAll(ids(item.path("samples")))) comparisons.add(LenientJson.asText(item.path("text")));
            }
            result.path("limits").forEach(item -> limits.add(LenientJson.asText(item)));
            suggestion = result.path("suggestion").isString() ? LenientJson.asText(result.path("suggestion")) : null;
        }
        return new Report(entryId, row.status().dbValue(), List.copyOf(observations), List.copyOf(comparisons),
                List.copyOf(limits), suggestion, sampleCount, row.attemptCount(), row.requestedAt(), row.completedAt());
    }

    @Override @Transactional(readOnly = true)
    public Material material(UUID jobId, UUID entryId) {
        var rows = NativeTuples.list(em.createNativeQuery("""
                SELECT e.user_id,c.line,v.object_key,v.content_type,v.duration_ms,e.challenge_id
                FROM entry_ai_reports r
                JOIN challenge_entries e ON e.id=r.entry_id
                JOIN challenges c ON c.id=e.challenge_id
                JOIN users u ON u.id=e.user_id
                JOIN videos v ON v.id=e.video_id
                WHERE r.entry_id=:entry AND r.job_id=:job AND r.status='pending' AND r.purged_at IS NULL
                  AND e.status<>'deleted' AND u.status='active' AND v.purged_at IS NULL
                """, Tuple.class).setParameter("entry", entryId).setParameter("job", jobId));
        if (rows.isEmpty()) return null;
        Tuple row = rows.getFirst();
        UUID owner = row.get("user_id", UUID.class);
        // 작성자당 가장 최근 공개 참여작 하나, 그 가운데 최근 다섯. 좋아요 수는 기준이 아니다.
        var samples = NativeTuples.list(em.createNativeQuery("""
                SELECT id,object_key,content_type,duration_ms FROM (
                  SELECT DISTINCT ON (e.user_id) e.id,e.published_at,v.object_key,v.content_type,v.duration_ms
                  %s WHERE e.challenge_id=:challenge AND e.user_id<>CAST(:viewer AS uuid) AND %s AND %s
                  ORDER BY e.user_id,e.published_at DESC,e.id DESC
                ) latest ORDER BY published_at DESC,id DESC LIMIT %d
                """.formatted(ChallengeVisibility.ENTRY_FROM, ChallengeVisibility.PUBLIC_ENTRY, ChallengeVisibility.UNBLOCKED,
                ChallengeReportRules.MAX_SAMPLES), Tuple.class)
                .setParameter("challenge", row.get("challenge_id", UUID.class)).setParameter("viewer", owner)).stream()
                .map(sample -> new Sample(sample.get("id", UUID.class), video(sample))).toList();
        return new Material(row.get("line", String.class), video(row), samples);
    }

    @Override @Transactional
    public boolean complete(UUID jobId, UUID leaseToken, UUID entryId, Result result, String model, Instant now) {
        // 참여작 행을 먼저 잡는다 — 삭제도 참여작 → 리포트 순서로 잡으므로, 겹치면 한쪽이 끝난 뒤 다른 쪽이 상태를 본다.
        entries.lockRow(entryId);
        var locked = NativeTuples.list(em.createNativeQuery("""
                SELECT r.user_id,e.challenge_id FROM entry_ai_reports r JOIN challenge_entries e ON e.id=r.entry_id JOIN users u ON u.id=r.user_id
                WHERE r.entry_id=:entry AND r.job_id=:job AND r.status='pending' AND r.purged_at IS NULL
                  AND e.status<>'deleted' AND u.status='active'
                FOR UPDATE OF r
                """, Tuple.class).setParameter("entry", entryId).setParameter("job", jobId));
        if (locked.isEmpty()) {
            // 만드는 사이 참여작이 지워졌거나 계정이 닫혔다 — 저장하지 않는다.
            ledger.fail(jobId, leaseToken, "cancelled", now);
            return false;
        }
        Set<UUID> eligible = eligible(locked.getFirst().get("user_id", UUID.class), result.samples());
        ObjectNode body = json.createObjectNode();
        var observations = body.putArray("observations");
        result.observations().forEach(item -> observations.addObject().put("start_ms", item.startMs()).put("end_ms", item.endMs())
                .put("text", item.text()));
        var comparisons = body.putArray("comparisons");
        result.comparisons().stream().filter(item -> eligible.containsAll(item.samples())).forEach(item -> {
            var node = comparisons.addObject().put("text", item.text());
            var ids = node.putArray("samples");
            item.samples().forEach(id -> ids.add(id.toString()));
        });
        var limits = body.putArray("limits");
        result.limits().forEach(limits::add);
        if (result.suggestion() == null) body.putNull("suggestion"); else body.put("suggestion", result.suggestion());
        var samples = body.putArray("samples");
        result.samples().stream().filter(eligible::contains).forEach(id -> samples.add(id.toString()));
        int attempts = ((Number) em.createNativeQuery("SELECT attempt_count FROM ai_jobs WHERE id=:job")
                .setParameter("job", jobId).getSingleResult()).intValue();
        reports.complete(entryId, body, model, attempts, now);
        if (!ledger.succeed(jobId, leaseToken, now)) throw new IllegalStateException("challenge report job was closed: " + jobId);
        events.record(locked.getFirst().get("user_id", UUID.class), "entry_ai_report_ready", null,
                locked.getFirst().get("challenge_id", UUID.class), entryId, null, "ai_report:" + jobId, now);
        return true;
    }

    @Override @Transactional
    public void attemptFailed(UUID jobId, UUID leaseToken, UUID entryId, int attempts, boolean terminal, String reason, Instant now) {
        if (terminal) reports.closeFailed(entryId, jobId, attempts);
        else reports.countAttempt(entryId, jobId, attempts);
        if (terminal) ledger.fail(jobId, leaseToken, reason, now);
        else ledger.release(jobId, leaseToken, reason, now);
    }

    @Override @Transactional
    public int closeAbandoned(Instant now) {
        List<UUID> closed = ledger.failExpired(KIND, now);
        if (closed.isEmpty()) return 0;
        em.createNativeQuery("""
                UPDATE entry_ai_reports r SET status='failed',attempt_count=j.attempt_count
                FROM ai_jobs j WHERE j.id=r.job_id AND r.job_id IN (:jobs) AND r.status='pending'
                """).setParameter("jobs", closed).executeUpdate();
        return closed.size();
    }

    /** 표본 조건을 지금도 지키는 것만. 공개 조건 + 요청자와 차단 없음 + 다른 작성자. */
    private Set<UUID> eligible(UUID owner, List<UUID> samples) {
        if (samples.isEmpty()) return Set.of();
        return new HashSet<>(NativeTuples.list(em.createNativeQuery("SELECT e.id " + ChallengeVisibility.ENTRY_FROM
                + " WHERE e.id IN (:ids) AND e.user_id<>CAST(:viewer AS uuid) AND " + ChallengeVisibility.PUBLIC_ENTRY + " AND "
                + ChallengeVisibility.UNBLOCKED, Tuple.class).setParameter("ids", samples).setParameter("viewer", owner))
                .stream().map(row -> row.get("id", UUID.class)).toList());
    }

    private static Video video(Tuple row) {
        return new Video(row.get("object_key", String.class), row.get("content_type", String.class),
                ((Number) row.get("duration_ms")).intValue());
    }

    private static List<UUID> ids(JsonNode array) {
        var ids = new ArrayList<UUID>();
        array.forEach(item -> ids.add(UUID.fromString(LenientJson.asText(item))));
        return ids;
    }
}
