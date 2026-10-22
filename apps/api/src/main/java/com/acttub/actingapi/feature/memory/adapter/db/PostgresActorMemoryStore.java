package com.acttub.actingapi.feature.memory.adapter.db;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.PracticeLoopRound;
import com.acttub.actingapi.feature.memory.app.ActorMemory;
import com.acttub.actingapi.feature.memory.app.ActorMemoryStore;
import com.acttub.actingapi.feature.memory.app.ActorMemoryUpdates;
import com.acttub.actingapi.feature.memory.app.CoachingProfileWriter;
import com.acttub.actingapi.feature.memory.app.MemoryScope;
import com.acttub.actingapi.feature.memory.app.MemoryOwnership;
import com.acttub.actingapi.feature.memory.app.MemoryUpdateMaterial;
import com.acttub.actingapi.feature.memory.app.ProfileMaterial;
import com.acttub.actingapi.feature.memory.domain.ActorMemoryFields;
import com.acttub.actingapi.feature.memory.domain.AgentMemoryWrites;
import com.acttub.actingapi.feature.memory.domain.MemoryValue;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.web.Hashing;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 0.1.0 배우 기억의 Postgres 구현 — {@code actor_memories}·{@code users.memory_epoch}·{@code ai_jobs} (V14).
 *
 * <p>옛 {@link PostgresMemoryRepository}({@code actor_memory_entries})와 다른 표를 본다. <b>이관의 주인
 * 바꾸기는 여기로 옮겼다</b> — 이관은 두 표를 함께 다뤄야 하는데, 그 앎을 0.1.0 저장소 한 곳에 두는 편이
 * 옛 저장소에 새 표를 알리는 것보다 짧다.
 *
 * <p>기억 세대는 {@code users} 행에 있다. 삭제와 이관 선택이 올리고, 갱신 작업은 예약 시점의 세대를 들고
 * 있다가 완료 때 다르면 아무것도 쓰지 않는다(practice.memory 「규칙·제약」).
 */
@Repository
public class PostgresActorMemoryStore implements ActorMemoryStore, ActorMemoryUpdates, MemoryOwnership {

    /** 회차 id 로 갱신 요청 id 를 만드는 이름공간 — 같은 회차는 언제나 같은 작업이다. */
    private static final UUID MEMORY_UPDATE_NAMESPACE =
            UUID.fromString("0f6b6f0a-2a56-5f1f-9a0e-2f0f8a5f5a11");

    /** 화면이 읽는 순서. 컬럼이 text 라 DB 는 이 순서를 모른다. */
    private static final String FIELD_ORDER = """
            CASE m.field WHEN 'goal' THEN 1 WHEN 'blockage' THEN 2 WHEN 'wants' THEN 3
                         WHEN 'habits' THEN 4 WHEN 'avoid' THEN 5 WHEN 'tone' THEN 6
                         WHEN 'speech_self' THEN 7 WHEN 'speech_actual' THEN 8 ELSE 9 END
            """;

    /**
     * 옛 표({@code actor_memory_entries})에서 호환 읽기로 내보내는 칸 — 0.1.0 이전 기억 네 칸이다. 성별·나이는 프로필의 것이라
     * 기억으로 읽지 않는다(practice README 「현행 → 0.1.0」).
     */
    private static final String LEGACY_FIELDS = "('goal','blockage','speech_self','speech_actual')";

    private static final ObjectMapper JSON = new ObjectMapper();

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final AiJobLedger jobs;

    PostgresActorMemoryStore(
            EntityManager entityManager, PlatformTransactionManager transactionManager, AiJobLedger jobs) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.jobs = jobs;
    }

    // --- 배우 쪽 -------------------------------------------------------------

    /**
     * 출처 연습이 <b>숨겨졌으면 링크만 없다</b> — 값과 작성자는 그대로다(practice.memory 규칙). 묶음 속성은
     * 첫 회차 행에 있으므로 {@code root_id} 를 따라가 본다.
     *
     * <p><b>새 표에 없는 칸은 옛 표를 읽는다(호환 읽기).</b> 0.1.0 데이터 전환이 돌기 전까지 그 전의 기억은 옛 표에만
     * 있다 — 새 표만 보면 화면도 코치도 그 기억을 잃는다. 옛 회차는 새 {@code practices} 에 없으므로 출처 링크는 없다.
     */
    @Override
    public List<ActorMemory> list(UUID userId) {
        // 장면 단위 칸은 장면마다 행이 있다(SOMA-795). 화면은 칸마다 하나를 보여 준다 — 배우가 쓴 행이 먼저이고, 없으면 가장
        // 최근 행이다. 스토어에 나간 앱이 칸마다 한 줄을 기대하므로 응답 모양은 그대로다.
        return NativeTuples.list(entityManager.createNativeQuery("""
                SELECT m.field,m.value,m.written_by,m.updated_at,m.source_practice_id
                FROM (
                    SELECT DISTINCT ON (u.field) u.*
                    FROM (
                        SELECT n.field,n.value,n.written_by,n.updated_at,
                               CASE WHEN root.hidden_at IS NULL THEN n.source_practice_id END AS source_practice_id
                        FROM actor_memories n
                        LEFT JOIN practices p ON p.id=n.source_practice_id
                        LEFT JOIN practices root ON root.id=p.root_id
                        WHERE n.user_id=:userId
                        UNION ALL
                        SELECT o.field,o.value,o.written_by,o.updated_at,CAST(NULL AS uuid) AS source_practice_id
                        FROM actor_memory_entries o
                        WHERE o.user_id=:userId
                          AND o.field IN %s
                          AND NOT EXISTS (SELECT 1 FROM actor_memories n
                                          WHERE n.user_id=o.user_id AND n.field=o.field)
                    ) u
                    ORDER BY u.field,(u.written_by='actor') DESC,u.updated_at DESC
                ) m
                ORDER BY %s
                """.formatted(LEGACY_FIELDS, FIELD_ORDER), Tuple.class)
                .setParameter("userId", userId)).stream()
                .map(PostgresActorMemoryStore::memory)
                .toList();
    }

    /**
     * 이 회차의 코치가 읽는 칸 (SOMA-795). 고르는 규칙은 {@link MemoryScope} 에 있다 — 여기는 행과 이 회차의 장면만 읽는다.
     * 옛 표의 칸은 장면 없는 행이다.
     */
    @Override
    public Map<String, String> forPractice(UUID userId, UUID practiceId) {
        UUID sceneRoot = practiceId == null ? null : sceneRoot(userId, practiceId);
        return MemoryScope.forScene(scopedRows(userId), sceneRoot);
    }

    private UUID sceneRoot(UUID userId, UUID practiceId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery(
                "SELECT root_id FROM practices WHERE id=:practiceId AND user_id=:userId", Tuple.class)
                .setParameter("practiceId", practiceId)
                .setParameter("userId", userId));
        return rows.isEmpty() ? null : rows.getFirst().get("root_id", UUID.class);
    }

    private List<MemoryScope.Row> scopedRows(UUID userId) {
        return NativeTuples.list(entityManager.createNativeQuery("""
                SELECT m.field,m.value,m.written_by,m.scene_root_id
                FROM (
                    SELECT n.field,n.value,n.written_by,n.scene_root_id,n.updated_at
                    FROM actor_memories n
                    WHERE n.user_id=:userId
                    UNION ALL
                    SELECT o.field,o.value,o.written_by,CAST(NULL AS uuid),o.updated_at
                    FROM actor_memory_entries o
                    WHERE o.user_id=:userId
                      AND o.field IN %s
                      AND NOT EXISTS (SELECT 1 FROM actor_memories n
                                      WHERE n.user_id=o.user_id AND n.field=o.field)
                ) m
                ORDER BY m.updated_at DESC
                """.formatted(LEGACY_FIELDS), Tuple.class)
                .setParameter("userId", userId)).stream()
                .map(row -> new MemoryScope.Row(
                        row.get("field", String.class),
                        row.get("value", String.class),
                        "actor".equals(row.get("written_by", String.class)),
                        row.get("scene_root_id", UUID.class)))
                .toList();
    }

    /**
     * {@code INSERT … SELECT FROM users} 인 것은 탈퇴한 계정에 기억이 다시 생기지 않게 하려는 것이다 —
     * 없는 사용자와 닫힌 계정이 FK 위반이 아니라 <b>0행</b>으로 돌아온다.
     */
    @Override
    public ActorMemory writeAsActor(UUID userId, String field, String value) {
        Instant now = Instant.now();
        // 화면이 보여 준 행({@link #list} 와 같은 순서로 고른 것)을 고친다 — 장면 칸이면 그 장면에 남는다(SOMA-795).
        // 그 칸에 행이 없으면 장면 없는 배우 단위 행으로 만든다. 배우가 장면 없이 쓴 값은 어느 장면에서나 읽힌다.
        return transaction.execute(tx -> {
            List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                    WITH target AS (
                        SELECT m.id FROM actor_memories m
                        WHERE m.user_id=:userId AND m.field=:field
                        ORDER BY (m.written_by='actor') DESC,m.updated_at DESC
                        LIMIT 1
                    ), updated AS (
                        UPDATE actor_memories m
                        SET value=:value,written_by='actor',source_practice_id=NULL,updated_at=:now
                        FROM target,users u
                        WHERE m.id=target.id AND u.id=m.user_id AND u.status='active'
                        RETURNING m.field,m.value,m.written_by,m.source_practice_id,m.updated_at
                    ), inserted AS (
                        INSERT INTO actor_memories(id,user_id,field,value,written_by,source_practice_id,
                                                   scene_root_id,created_at,updated_at)
                        SELECT :id,u.id,:field,:value,'actor',NULL,NULL,:now,:now
                        FROM users u
                        WHERE u.id=:userId AND u.status='active'
                          AND NOT EXISTS (SELECT 1 FROM target)
                        ON CONFLICT ON CONSTRAINT uq_actor_memories_user_field_scene DO UPDATE
                        SET value=EXCLUDED.value,written_by='actor',source_practice_id=NULL,
                            updated_at=EXCLUDED.updated_at
                        RETURNING field,value,written_by,source_practice_id,updated_at
                    )
                    SELECT field,value,written_by,source_practice_id,updated_at FROM updated
                    UNION ALL
                    SELECT field,value,written_by,source_practice_id,updated_at FROM inserted
                    """, Tuple.class)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("field", field)
                    .setParameter("value", value)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("userId", userId));
            return rows.isEmpty() ? null : memory(rows.getFirst());
        });
    }

    /**
     * 지운 것이 없어도 세대를 올린다 — "삭제 직후 늦게 끝난 갱신"뿐 아니라 "삭제 전에 예약만 된 갱신"도
     * 반영되지 않아야 하고, 그 둘을 가르는 것은 지운 행 수가 아니라 세대다.
     */
    @Override
    public void delete(UUID userId, String field) {
        transaction.executeWithoutResult(tx -> {
            var removal = entityManager.createNativeQuery(
                    "DELETE FROM actor_memories WHERE user_id=:userId"
                            + (field == null ? "" : " AND field=:field"))
                    .setParameter("userId", userId);
            if (field != null) {
                removal.setParameter("field", field);
            }
            removal.executeUpdate();
            // 호환 읽기로 보이던 옛 칸도 지운다 — 남기면 지운 기억이 다시 나타난다.
            var legacyRemoval = entityManager.createNativeQuery(
                    "DELETE FROM actor_memory_entries WHERE user_id=:userId AND field IN " + LEGACY_FIELDS
                            + (field == null ? "" : " AND field=:field"))
                    .setParameter("userId", userId);
            if (field != null) {
                legacyRemoval.setParameter("field", field);
            }
            legacyRemoval.executeUpdate();
            bumpEpoch(userId);
        });
    }

    // --- 이관 ---------------------------------------------------------------

    /** 옛 표와 새 표를 함께 본다 — 어느 쪽에라도 있으면 "기억이 있다"다. */
    @Override
    public boolean hasMemory(UUID userId) {
        return ((Number) entityManager.createNativeQuery("""
                SELECT (SELECT count(*) FROM actor_memories WHERE user_id=:userId)
                     + (SELECT count(*) FROM actor_memory_entries WHERE user_id=:userId)
                """)
                .setParameter("userId", userId)
                .getSingleResult()).intValue() > 0;
    }

    /** 트랜잭션을 열지 않는다 — 부르는 쪽(이관)의 것에 참여한다. */
    @Override
    public void discard(UUID userId) {
        for (String table : List.of("actor_memories", "actor_memory_entries")) {
            entityManager.createNativeQuery("DELETE FROM " + table + " WHERE user_id=:userId")
                    .setParameter("userId", userId)
                    .executeUpdate();
        }
    }

    @Override
    public void reassign(UUID from, UUID to) {
        for (String table : List.of("actor_memories", "actor_memory_entries")) {
            entityManager.createNativeQuery(
                    "UPDATE " + table + " SET user_id=:to WHERE user_id=:from")
                    .setParameter("to", to)
                    .setParameter("from", from)
                    .executeUpdate();
        }
    }

    @Override
    public void bumpEpoch(UUID userId) {
        entityManager.createNativeQuery("""
                UPDATE users SET memory_epoch=memory_epoch+1,updated_at=now()
                WHERE id=:userId
                """)
                .setParameter("userId", userId)
                .executeUpdate();
    }

    // --- 갱신 작업 -----------------------------------------------------------

    @Override
    public boolean schedule(UUID userId, UUID practiceId, Instant now) {
        return Boolean.TRUE.equals(transaction.execute(tx -> {
            // 끝난 대화마다 예약한다(SOMA-795) — 노트가 남은 회차(record_only 제외)와, 열린 채 남았어도 배우가 두 번 이상 답한
            // 회차다. 예전의 1·3·6·9번째 규칙은 자주 연습하는 배우의 기억을 낡게 했다.
            boolean finished = !NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT p.id
                    FROM practices p
                    WHERE p.id=:practiceId AND p.user_id=:userId
                      AND (EXISTS (SELECT 1 FROM coach_notes n
                                   JOIN coach_conversations c ON c.id=n.conversation_id
                                   WHERE c.practice_id=p.id AND n.kind<>'record_only')
                           OR EXISTS (SELECT 1 FROM coach_conversations c
                                      WHERE c.practice_id=p.id
                                        AND (SELECT count(*) FROM coach_messages m
                                             WHERE m.conversation_id=c.id AND m.role='actor')>=2))
                    """, Tuple.class)
                    .setParameter("userId", userId)
                    .setParameter("practiceId", practiceId)).isEmpty();
            if (!finished) {
                return false;
            }
            UUID requestId = uuid5(MEMORY_UPDATE_NAMESPACE, practiceId.toString());
            return !NativeTuples.list(entityManager.createNativeQuery("""
                    WITH inserted AS (
                        INSERT INTO ai_jobs(id,user_id,kind,target_id,request_id,request_fingerprint,
                                            status,memory_epoch,created_at,updated_at)
                        SELECT :id,u.id,'memory_update',:practiceId,:requestId,CAST(:fingerprint AS bpchar),
                               'pending',u.memory_epoch,:now,:now
                        FROM users u
                        WHERE u.id=:userId AND u.status='active'
                        ON CONFLICT (user_id,request_id) DO NOTHING
                        RETURNING id
                    )
                    SELECT id FROM inserted
                    """, Tuple.class)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("practiceId", practiceId)
                    .setParameter("requestId", requestId)
                    .setParameter("fingerprint", Hashing.sha256Hex("memory_update:" + practiceId))
                    .setParameter("userId", userId)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))).isEmpty();
        }));
    }

    @Override
    public Claimed claim(UUID leaseToken, Duration lease, Instant now) {
        AiJobLedger.Claimed claimed = jobs.claimNext("memory_update", leaseToken, lease, now);
        return claimed == null
                ? null
                : new Claimed(claimed.id(), claimed.userId(), claimed.targetId(), claimed.memoryEpoch());
    }

    /**
     * 모델에 넘길 재료 (practice.memory). <b>배우가 한 말만 담는다</b> — 코치가 한 말까지 넣으면 코치가
     * 제안한 표현이 배우 본인의 말로 굳어 기억에 남는다.
     */
    @Override
    public MemoryUpdateMaterial material(UUID practiceId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT p.user_id,p.goal,p.blockage_kind,p.sub_branch,p.blockage_detail,
                       p.video_id,CAST(a.record AS text) AS record
                FROM practices p
                LEFT JOIN practices root ON root.id=p.root_id
                LEFT JOIN analyses a ON a.practice_id=p.id
                WHERE p.id=:practiceId
                  AND root.hidden_at IS NULL
                """, Tuple.class)
                .setParameter("practiceId", practiceId));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        List<Round> rounds = rounds(practiceId);
        return new MemoryUpdateMaterial(
                row.get("user_id", UUID.class),
                practiceId,
                row.get("goal", String.class),
                row.get("blockage_kind", String.class),
                row.get("sub_branch", String.class),
                row.get("blockage_detail", String.class),
                transcripts(row.get("video_id", UUID.class)),
                rounds.stream().flatMap(round -> round.actorWords().stream()).toList(),
                quotations(row.get("record", String.class)),
                rounds.stream().map(Round::note).filter(java.util.Objects::nonNull).toList());
    }

    /** 한 대화의 배우 말(연습 루프면 분류를 붙여서)과 세션.md 한 줄. */
    private record Round(List<String> actorWords, String note, List<String> corrections) {
    }

    private List<Round> rounds(UUID practiceId) {
        List<Round> rounds = new ArrayList<>();
        for (Tuple conversation : NativeTuples.list(entityManager.createNativeQuery("""
                SELECT c.id,CAST(c.state AS text) AS state,n.title,n.next_take,p.ordinal
                FROM coach_conversations c
                JOIN practices p ON p.id=c.practice_id
                LEFT JOIN coach_notes n ON n.conversation_id=c.id
                WHERE c.practice_id=:practiceId
                ORDER BY c.created_at,c.id
                """, Tuple.class)
                .setParameter("practiceId", practiceId))) {
            List<PracticeLoopRound.Turn> turns = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT role,text FROM coach_messages WHERE conversation_id=:id ORDER BY turn_index
                    """, Tuple.class)
                    .setParameter("id", conversation.get("id", UUID.class))).stream()
                    .map(turn -> new PracticeLoopRound.Turn(turn.get("role", String.class), turn.get("text", String.class)))
                    .toList();
            JsonNode state = json(conversation.get("state", String.class));
            Number ordinal = (Number) conversation.get("ordinal");
            rounds.add(new Round(
                    PracticeLoopRound.classifiedActorWords(state, turns),
                    PracticeLoopRound.line(ordinal == null ? 1 : ordinal.intValue(),
                            conversation.get("title", String.class), conversation.get("next_take", String.class),
                            state, turns),
                    PracticeLoopRound.corrections(state, turns)));
        }
        return rounds;
    }

    /** 다시 말하지 않을 것에 남기는 줄 수의 상한 — 넘치면 오래된 것부터 뺀다. */
    private static final int AVOID_MAX_LINES = 12;

    @Override
    public boolean appendAvoid(UUID userId, UUID practiceId, Instant now) {
        // 이 칸의 마이그레이션이 없는 배포에서는 쓰지 않는다.
        if (!ActorMemoryFields.contains("avoid")) {
            return false;
        }
        return Boolean.TRUE.equals(transaction.execute(tx -> {
            List<String> corrections = rounds(practiceId).stream()
                    .flatMap(round -> round.corrections().stream()).toList();
            if (corrections.isEmpty()) {
                return false;
            }
            List<Tuple> current = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT m.value,m.written_by
                    FROM users u
                    LEFT JOIN actor_memories m ON m.user_id=u.id AND m.field='avoid'
                         AND m.scene_root_id IS NOT DISTINCT FROM
                             (SELECT p.root_id FROM practices p WHERE p.id=:practiceId)
                    WHERE u.id=:userId AND u.status='active'
                    FOR UPDATE OF u
                    """, Tuple.class)
                    .setParameter("userId", userId)
                    .setParameter("practiceId", practiceId));
            // 닫힌 계정이거나 배우가 직접 고친 칸이면 손대지 않는다. 다시 말하지 않을 것은 장면 단위다(SOMA-795) — 이 장면의 행만 본다.
            if (current.isEmpty() || "actor".equals(current.getFirst().get("written_by", String.class))) {
                return false;
            }
            String before = current.getFirst().get("value", String.class);
            List<String> lines = new ArrayList<>(before == null ? List.of()
                    : before.lines().map(String::strip).filter(line -> !line.isEmpty()).toList());
            boolean added = false;
            for (String correction : corrections) {
                String line = "- " + correction;
                if (!lines.contains(line)) {
                    lines.add(line);
                    added = true;
                }
            }
            if (!added) {
                return false;
            }
            while (lines.size() > AVOID_MAX_LINES
                    || String.join("\n", lines).codePointCount(0, String.join("\n", lines).length()) > MemoryValue.MAX_LENGTH) {
                lines.removeFirst();
            }
            if (lines.isEmpty()) {
                return false;
            }
            return writeAsAgent(userId, "avoid", String.join("\n", lines), practiceId, now);
        }));
    }

    @Override
    public List<Idle> idle(Instant now) {
        // 배우가 두 번 이상 답하고 30분 넘게 말이 없는 열린 대화. 하루가 넘은 것은 보지 않는다 — 배포 때 옛 회차를
        // 한꺼번에 다시 읽지 않게 한다.
        return NativeTuples.list(entityManager.createNativeQuery("""
                SELECT p.user_id,p.id AS practice_id
                FROM coach_conversations c
                JOIN practices p ON p.id=c.practice_id
                JOIN users u ON u.id=p.user_id AND u.status='active'
                WHERE c.status='open'
                  AND (SELECT count(*) FROM coach_messages m WHERE m.conversation_id=c.id AND m.role='actor')>=2
                  AND (SELECT max(m.created_at) FROM coach_messages m WHERE m.conversation_id=c.id)
                      BETWEEN :from AND :until
                  AND NOT EXISTS (SELECT 1 FROM ai_jobs j WHERE j.kind='memory_update' AND j.target_id=p.id)
                ORDER BY p.created_at,p.id
                LIMIT 50
                """, Tuple.class)
                .setParameter("from", now.minus(Duration.ofHours(24)).atOffset(ZoneOffset.UTC))
                .setParameter("until", now.minus(Duration.ofMinutes(30)).atOffset(ZoneOffset.UTC))).stream()
                .map(row -> new Idle(row.get("user_id", UUID.class), row.get("practice_id", UUID.class)))
                .toList();
    }

    @Override
    public Map<String, String> current(UUID userId, UUID practiceId) {
        Map<String, String> values = new LinkedHashMap<>(forPractice(userId, practiceId));
        // 맞춤 코칭은 칸 갱신의 입력이 아니다 — 따로 다시 쓴다({@link #profileMaterial}).
        values.remove(ActorMemoryFields.COACHING_PROFILE);
        return values;
    }

    /** 맞춤 코칭이 읽는 기간. 그보다 오래된 대화는 지금의 배우를 말해 주지 않는다. */
    static final Duration PROFILE_WINDOW = Duration.ofDays(60);

    @Override
    public ProfileMaterial profileMaterial(UUID userId, Instant now) {
        boolean active = !NativeTuples.list(entityManager.createNativeQuery(
                "SELECT id FROM users WHERE id=:userId AND status='active'", Tuple.class)
                .setParameter("userId", userId)).isEmpty();
        if (!active) {
            return null;
        }
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT c.id,c.close_reason,CAST(c.state AS text) AS state,
                       to_char(c.created_at AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD') AS day,
                       (SELECT count(*) FROM coach_messages m WHERE m.conversation_id=c.id AND m.role='actor') AS replies,
                       r.rating,r.comment,n.title AS note_title,n.next_take,
                       CAST(p.goal AS text) AS goal,CAST(p.situation AS text) AS situation,
                       CAST(p.character_context AS text) AS character_context
                FROM coach_conversations c
                JOIN practices p ON p.id=c.practice_id
                LEFT JOIN LATERAL (
                    SELECT nr.rating,nr.comment FROM coach_notes n
                    JOIN note_ratings nr ON nr.note_id=n.id AND nr.user_id=p.user_id
                    WHERE n.conversation_id=c.id
                    ORDER BY nr.updated_at DESC LIMIT 1
                ) r ON true
                LEFT JOIN LATERAL (
                    SELECT n.title,n.next_take FROM coach_notes n WHERE n.conversation_id=c.id
                    ORDER BY n.created_at DESC LIMIT 1
                ) n ON true
                WHERE p.user_id=:userId AND c.created_at>=:since
                  AND EXISTS (SELECT 1 FROM coach_messages m WHERE m.conversation_id=c.id AND m.role='actor')
                ORDER BY c.created_at DESC,c.id DESC
                LIMIT :limit
                """, Tuple.class)
                .setParameter("userId", userId)
                .setParameter("since", now.minus(PROFILE_WINDOW).atOffset(ZoneOffset.UTC))
                .setParameter("limit", CoachingProfileWriter.MAX_CONVERSATIONS));
        List<ProfileMaterial.Conversation> conversations = new ArrayList<>();
        List<String> sceneTexts = new ArrayList<>();
        for (Tuple row : rows) {
            List<PracticeLoopRound.Turn> turns = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT role,text FROM coach_messages WHERE conversation_id=:id ORDER BY turn_index
                    """, Tuple.class)
                    .setParameter("id", row.get("id", UUID.class))).stream()
                    .map(turn -> new PracticeLoopRound.Turn(turn.get("role", String.class), turn.get("text", String.class)))
                    .toList();
            JsonNode state = json(row.get("state", String.class));
            conversations.add(new ProfileMaterial.Conversation(
                    row.get("day", String.class),
                    row.get("close_reason", String.class),
                    ((Number) row.get("replies")).intValue(),
                    profileTurns(state, turns),
                    row.get("rating", String.class),
                    row.get("comment", String.class),
                    PracticeLoopRound.corrections(state, turns)));
            // 노트 제목·다음 테이크에도 인물·상대가 들어 있다("아빠한테 무엇을 얻으려는지") — 장면 내용 검사에 함께 쓴다.
            for (String column : List.of("goal", "situation", "character_context", "note_title", "next_take")) {
                String text = row.get(column, String.class);
                if (text != null && !text.isBlank()) sceneTexts.add(text);
            }
        }
        Map<String, String> actorLevel = new LinkedHashMap<>();
        Map<String, String> memory = forPractice(userId, null);
        for (String field : List.of("wants", "tone")) {
            if (memory.containsKey(field)) actorLevel.put(field, memory.get(field));
        }
        return new ProfileMaterial(userId, conversations, actorLevel,
                memory.get(ActorMemoryFields.COACHING_PROFILE), sceneTexts);
    }

    /** 코치 말은 그대로, 배우 말은 대화 중에 붙인 분류("(정정) …")를 앞에 붙여 담는다. */
    private static List<ProfileMaterial.Turn> profileTurns(JsonNode state, List<PracticeLoopRound.Turn> turns) {
        List<String> classified = PracticeLoopRound.classifiedActorWords(state, turns);
        List<ProfileMaterial.Turn> out = new ArrayList<>();
        int actor = 0;
        for (PracticeLoopRound.Turn turn : turns) {
            String text = turn.text() == null ? "" : turn.text().strip();
            if (text.isEmpty()) continue;
            if ("ai".equals(turn.role())) {
                out.add(new ProfileMaterial.Turn("ai", text));
            } else {
                out.add(new ProfileMaterial.Turn("actor", actor < classified.size() ? classified.get(actor) : text));
                actor++;
            }
        }
        return out;
    }

    @Override
    public List<String> complete(Claimed claimed, UUID leaseToken, Map<String, String> updates, Instant now) {
        return transaction.execute(tx -> {
            List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT j.user_id,u.status,u.memory_epoch
                    FROM ai_jobs j
                    JOIN users u ON u.id=j.user_id
                    WHERE j.id=:jobId
                    FOR UPDATE OF u
                    """, Tuple.class)
                    .setParameter("jobId", claimed.jobId()));
            if (rows.isEmpty()) {
                throw new IllegalStateException("ai job not found: " + claimed.jobId());
            }
            Tuple row = rows.getFirst();
            // 모델을 기다리는 사이에 이관이 주인을 회원으로 바꿨을 수 있다 — 지금의 주인에게 쓴다.
            UUID owner = row.get("user_id", UUID.class);
            if (!"active".equals(row.get("status", String.class))) {
                jobs.fail(claimed.jobId(), leaseToken, "account_deactivated", now);
                return List.of();
            }
            int epoch = ((Number) row.get("memory_epoch")).intValue();
            // 삭제·이관 선택이 세대를 올렸으면 이 결과는 지난 기억이다. 되살리지 않는다.
            if (claimed.memoryEpoch() != null && claimed.memoryEpoch() != epoch) {
                jobs.fail(claimed.jobId(), leaseToken, "memory_epoch_stale", now);
                return List.of();
            }
            List<String> written = new ArrayList<>();
            // 여러 연습이 같은 배우를 갱신해도 기억 행의 잠금을 같은 순서로 얻는다.
            for (String field : AgentMemoryWrites.FIELDS) {
                String value = updates.get(field);
                if (value != null && writeAsAgent(owner, field, value, claimed.practiceId(), now)) {
                    written.add(field);
                }
            }
            jobs.succeed(claimed.jobId(), leaseToken, now);
            // 원장 응답은 저장 순서가 아니라 모델 응답의 필드 순서를 보존한다.
            return updates.keySet().stream().filter(written::contains).toList();
        });
    }

    @Override
    public void release(UUID jobId, UUID leaseToken, String reason, Instant now) {
        jobs.release(jobId, leaseToken, reason, now);
    }

    /**
     * 배우가 손댄 칸은 건너뛴다 — {@code WHERE} 가 0행을 내고 그것이 "쓰지 않았다"다. 새 표에 아직 없고 옛 표에 배우가 적은
     * 칸(호환 읽기로 보이는 칸)도 배우 것이므로 덮지 않는다.
     */
    private boolean writeAsAgent(UUID userId, String field, String value, UUID practiceId, Instant now) {
        // 장면 단위 칸은 그 회차의 장면(root_id)에 쓴다(SOMA-795). 배우가 그 장면의 행을 고쳤으면 0행이고 그것이 "쓰지 않았다"다.
        return !NativeTuples.list(entityManager.createNativeQuery("""
                INSERT INTO actor_memories(id,user_id,field,value,written_by,source_practice_id,
                                           scene_root_id,created_at,updated_at)
                SELECT :id,:userId,:field,:value,'agent',:practiceId,
                       CASE WHEN CAST(:scoped AS boolean)
                            THEN (SELECT p.root_id FROM practices p WHERE p.id=:practiceId) END,
                       :now,:now
                WHERE NOT EXISTS (SELECT 1 FROM actor_memory_entries o
                                  WHERE o.user_id=:userId AND o.field=:field AND o.written_by='actor'
                                    AND NOT EXISTS (SELECT 1 FROM actor_memories n
                                                    WHERE n.user_id=o.user_id AND n.field=o.field))
                ON CONFLICT ON CONSTRAINT uq_actor_memories_user_field_scene DO UPDATE
                SET value=EXCLUDED.value,written_by='agent',
                    source_practice_id=EXCLUDED.source_practice_id,updated_at=EXCLUDED.updated_at
                WHERE actor_memories.written_by<>'actor'
                RETURNING field
                """, Tuple.class)
                .setParameter("id", UUID.randomUUID())
                .setParameter("userId", userId)
                .setParameter("field", field)
                .setParameter("value", value)
                .setParameter("practiceId", practiceId)
                .setParameter("scoped", ActorMemoryFields.sceneScoped(field))
                .setParameter("now", now.atOffset(ZoneOffset.UTC))).isEmpty();
    }

    /** 받아쓰기는 영상당 묶음 하나다(practice.record) — 같은 영상의 다음 회차가 그대로 읽는다. */
    private List<String> transcripts(UUID videoId) {
        if (videoId == null) {
            return List.of();
        }
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT CAST(segments AS text) AS segments
                FROM video_transcripts
                WHERE video_id=:videoId AND status='ready'
                """, Tuple.class)
                .setParameter("videoId", videoId));
        if (rows.isEmpty()) {
            return List.of();
        }
        List<String> texts = new ArrayList<>();
        for (JsonNode segment : json(rows.getFirst().get("segments", String.class))) {
            JsonNode text = segment.path("text");
            if (text.isTextual() && !text.textValue().isBlank()) {
                texts.add(text.textValue());
            }
        }
        return List.copyOf(texts);
    }

    /**
     * 관찰이 인용한 대사. 기존 갈래(ObservationPack)는 {@code observations[].quote} 이고, 신형 기록의 발화는
     * 이미 받아쓰기로 들어가므로 여기서 다시 담지 않는다.
     */
    private List<String> quotations(String record) {
        List<String> quotes = new ArrayList<>();
        for (JsonNode observation : json(record).path("observations")) {
            JsonNode quote = observation.path("quote");
            if (quote.isTextual() && !quote.textValue().isBlank()) {
                quotes.add(quote.textValue());
            }
        }
        return List.copyOf(quotes);
    }

    private static JsonNode json(String raw) {
        if (raw == null || raw.isBlank()) {
            return JSON.createObjectNode();
        }
        try {
            return JSON.readTree(raw);
        } catch (com.fasterxml.jackson.core.JsonProcessingException unreadable) {
            throw new IllegalStateException("stored practice JSON could not be parsed", unreadable);
        }
    }

    private static ActorMemory memory(Tuple row) {
        return new ActorMemory(
                row.get("field", String.class),
                row.get("value", String.class),
                "actor".equals(row.get("written_by", String.class)),
                row.get("source_practice_id", UUID.class),
                row.get("updated_at", Instant.class));
    }

    /**
     * RFC 4122 v5 (SHA-1). 같은 회차가 언제나 같은 요청 id 를 갖는다. {@code UUID.nameUUIDFromBytes} 는
     * v3(MD5)라 쓰지 않는다.
     */
    static UUID uuid5(UUID namespace, String name) {
        byte[] nameBytes = name.getBytes(StandardCharsets.UTF_8);
        ByteBuffer buffer = ByteBuffer.allocate(16 + nameBytes.length);
        buffer.putLong(namespace.getMostSignificantBits());
        buffer.putLong(namespace.getLeastSignificantBits());
        buffer.put(nameBytes);
        byte[] hash = digest("SHA-1").digest(buffer.array());
        hash[6] = (byte) ((hash[6] & 0x0f) | 0x50);
        hash[8] = (byte) ((hash[8] & 0x3f) | 0x80);
        ByteBuffer out = ByteBuffer.wrap(hash, 0, 16);
        return new UUID(out.getLong(), out.getLong());
    }

    private static MessageDigest digest(String algorithm) {
        try {
            return MessageDigest.getInstance(algorithm);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(algorithm + " 을 쓸 수 없다", impossible);
        }
    }
}
