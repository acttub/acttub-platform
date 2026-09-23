package com.acttub.actingapi.feature.memory.adapter.db;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.memory.app.ActorMemory;
import com.acttub.actingapi.feature.memory.app.ActorMemoryStore;
import com.acttub.actingapi.feature.memory.app.ActorMemoryUpdates;
import com.acttub.actingapi.feature.memory.app.MemoryOwnership;
import com.acttub.actingapi.feature.memory.app.MemoryUpdateMaterial;
import com.acttub.actingapi.feature.memory.domain.AgentMemoryWrites;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 1.0.0 배우 기억의 Postgres 구현 — {@code actor_memories}·{@code users.memory_epoch}·{@code ai_jobs} (V14).
 *
 * <p>옛 {@link PostgresMemoryRepository}({@code actor_memory_entries})와 다른 표를 본다. <b>이관의 주인
 * 바꾸기는 여기로 옮겼다</b> — 이관은 두 표를 함께 다뤄야 하는데, 그 앎을 1.0.0 저장소 한 곳에 두는 편이
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
            CASE m.field WHEN 'goal' THEN 1 WHEN 'blockage' THEN 2
                         WHEN 'speech_self' THEN 3 ELSE 4 END
            """;

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
     */
    @Override
    public List<ActorMemory> list(UUID userId) {
        return NativeTuples.list(entityManager.createNativeQuery("""
                SELECT m.field,m.value,m.written_by,m.updated_at,
                       CASE WHEN root.hidden_at IS NULL THEN m.source_practice_id END AS source_practice_id
                FROM actor_memories m
                LEFT JOIN practices p ON p.id=m.source_practice_id
                LEFT JOIN practices root ON root.id=p.root_id
                WHERE m.user_id=:userId
                ORDER BY %s
                """.formatted(FIELD_ORDER), Tuple.class)
                .setParameter("userId", userId)).stream()
                .map(PostgresActorMemoryStore::memory)
                .toList();
    }

    /**
     * {@code INSERT … SELECT FROM users} 인 것은 탈퇴한 계정에 기억이 다시 생기지 않게 하려는 것이다 —
     * 없는 사용자와 닫힌 계정이 FK 위반이 아니라 <b>0행</b>으로 돌아온다.
     */
    @Override
    public ActorMemory writeAsActor(UUID userId, String field, String value) {
        Instant now = Instant.now();
        return transaction.execute(tx -> {
            List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                    INSERT INTO actor_memories(id,user_id,field,value,written_by,source_practice_id,
                                               created_at,updated_at)
                    SELECT :id,u.id,:field,:value,'actor',NULL,:now,:now
                    FROM users u
                    WHERE u.id=:userId AND u.status='active'
                    ON CONFLICT ON CONSTRAINT uq_actor_memories_user_field DO UPDATE
                    SET value=EXCLUDED.value,written_by='actor',source_practice_id=NULL,
                        updated_at=EXCLUDED.updated_at
                    RETURNING field,value,written_by,source_practice_id,updated_at
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
            long confirmed = ((Number) entityManager.createNativeQuery("""
                    SELECT count(*)
                    FROM coach_notes n
                    JOIN coach_conversations c ON c.id=n.conversation_id
                    JOIN practices p ON p.id=c.practice_id
                    WHERE p.user_id=:userId
                      AND n.kind<>'record_only'
                    """)
                    .setParameter("userId", userId)
                    .getSingleResult()).longValue();
            // 첫 확인 연습과 그 뒤 3의 배수(1·3·6·9…). record_only 는 위 질의가 이미 뺐다.
            if (confirmed == 0 || (confirmed != 1 && confirmed % 3 != 0)) {
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
                    .setParameter("fingerprint", sha256Hex("memory_update:" + practiceId))
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
        return new MemoryUpdateMaterial(
                row.get("user_id", UUID.class),
                practiceId,
                row.get("goal", String.class),
                row.get("blockage_kind", String.class),
                row.get("sub_branch", String.class),
                row.get("blockage_detail", String.class),
                transcripts(row.get("video_id", UUID.class)),
                actorMessages(practiceId),
                quotations(row.get("record", String.class)));
    }

    @Override
    public Map<String, String> current(UUID userId) {
        Map<String, String> values = new LinkedHashMap<>();
        list(userId).forEach(row -> values.put(row.field(), row.value()));
        return values;
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

    /** 배우가 손댄 칸은 건너뛴다 — {@code WHERE} 가 0행을 내고 그것이 "쓰지 않았다"다. */
    private boolean writeAsAgent(UUID userId, String field, String value, UUID practiceId, Instant now) {
        return !NativeTuples.list(entityManager.createNativeQuery("""
                INSERT INTO actor_memories(id,user_id,field,value,written_by,source_practice_id,
                                           created_at,updated_at)
                VALUES (:id,:userId,:field,:value,'agent',:practiceId,:now,:now)
                ON CONFLICT ON CONSTRAINT uq_actor_memories_user_field DO UPDATE
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

    private List<String> actorMessages(UUID practiceId) {
        return NativeTuples.list(entityManager.createNativeQuery("""
                SELECT m.text
                FROM coach_messages m
                JOIN coach_conversations c ON c.id=m.conversation_id
                WHERE c.practice_id=:practiceId AND m.role='actor'
                ORDER BY m.turn_index
                """, Tuple.class)
                .setParameter("practiceId", practiceId)).stream()
                .map(row -> row.get("text", String.class))
                .toList();
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

    /** RFC 4122 v5 (SHA-1). 같은 회차가 언제나 같은 요청 id 를 갖는다. */
    private static UUID uuid5(UUID namespace, String name) {
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

    private static String sha256Hex(String value) {
        return HexFormat.of().formatHex(digest("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));
    }

    private static MessageDigest digest(String algorithm) {
        try {
            return MessageDigest.getInstance(algorithm);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(algorithm + " 을 쓸 수 없다", impossible);
        }
    }
}
