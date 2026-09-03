package com.acttub.actingapi.feature.memory.adapter.db;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.time.ZoneId;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.CoachMemory;
import com.acttub.actingapi.feature.coach.app.PriorContext;
import com.acttub.actingapi.feature.memory.app.MemoryEntry;
import com.acttub.actingapi.feature.memory.app.MemoryRepository;
import com.acttub.actingapi.feature.memory.app.MemoryUpdateMaterial;
import com.acttub.actingapi.feature.memory.domain.AgentMemoryWrites;
import com.acttub.actingapi.feature.memory.schema.ActorMemoryEntryEntity;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.web.PythonText;
import com.acttub.actingapi.platform.schema.ActorMemoryAuthor;
import com.acttub.actingapi.platform.schema.ActorMemoryField;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 배우 기억 6칸의 저장 계층 (`db/store.py:PostgresStore.list_actor_memory` 외).
 *
 * <p><b>배우가 손댄 칸은 에이전트가 덮지 않는다.</b> 읽고 나서 판단하면 그 사이 배우가
 * 고친 것을 덮을 수 있어, 조건을 {@code ON CONFLICT ... WHERE} 안에 둬서 한 문장으로
 * 끝낸다 — 건너뛰면 {@code RETURNING} 이 0행이라 {@code null} 이 돌아온다.
 */
@Repository
public class PostgresMemoryRepository implements MemoryRepository, CoachMemory {
    /** 차수 날짜는 배우가 보는 시간대로 적는다 — 자정 직전 연습이 "다른 날" 이 되면 어색하다. */
    private static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    /** `store.py:_MEMORY_UPDATE_NAMESPACE` 와 같은 값이어야 잡이 멱등해진다. */
    private static final UUID MEMORY_UPDATE_NAMESPACE =
            UUID.fromString("6f3a1d52-8c47-4b19-9e0a-2d5c7b41f8e3");

    private final ActorMemoryEntryJpaRepository entries;
    private final EntityManager entityManager;
    private final Clock clock;
    private final ObjectMapper mapper;
    private final TransactionTemplate transaction;
    private final FailureReporter failureReporter;

    public PostgresMemoryRepository(
            ActorMemoryEntryJpaRepository entries,
            EntityManager entityManager,
            Clock clock,
            ObjectMapper mapper,
            PlatformTransactionManager transactionManager,
            FailureReporter failureReporter) {
        this.entries = entries;
        this.entityManager = entityManager;
        this.clock = clock;
        this.mapper = mapper;
        this.transaction = new TransactionTemplate(transactionManager);
        this.failureReporter = failureReporter;
    }

    /**
     * 빈 칸은 행이 없는 것이므로 6개보다 적게 돌아올 수 있다.
     *
     * <p><b>정렬은 화면이 읽는 칸 순서다</b> — 성별·나이·목표·막힘·자기 화술·실제 화술.
     * 컬럼이 {@code actor_memory_field_t} 이던 시절에는 enum 정의 순서가 이 일을 대신했지만,
     * text 가 된 지금은 그냥 두면 사전순({@code age, blockage, gender, …})으로 갈린다.
     * 그래서 {@code CASE} 로 옛 순서를 못박는다 (SOMA-462).
     */
    @Override
    public List<MemoryEntry> list(UUID userId) {
        return entries.findOrderedByUserId(userId).stream()
                .map(PostgresMemoryRepository::entry)
                .toList();
    }

    /** 배우가 직접 쓰거나 고친다. 항상 이긴다. */
    @Override
    public MemoryEntry writeAsActor(UUID userId, ActorMemoryField field, String value) {
        return upsert(userId, field, value, ActorMemoryAuthor.ACTOR, null);
    }

    /**
     * 에이전트가 갱신한다. 배우가 손댄 칸은 건드리지 않고 {@code null} 을 돌려준다 —
     * 부르는 쪽이 "덮어썼다" 고 착각하지 않게 하려는 것이다.
     *
     * <p>성별·나이는 DB 제약이 막으므로 여기서 미리 걸러 불필요한 예외를 만들지 않는다.
     */
    @Override
    public MemoryEntry writeAsAgent(
            UUID userId, ActorMemoryField field, String value, UUID sourcePracticeSessionId) {
        if (!AgentMemoryWrites.allows(field.dbValue())) {
            return null;
        }
        return upsert(userId, field, value, ActorMemoryAuthor.AGENT, sourcePracticeSessionId);
    }

    private MemoryEntry upsert(
            UUID userId,
            ActorMemoryField field,
            String value,
            ActorMemoryAuthor author,
            UUID sourcePracticeSessionId) {
        OffsetDateTime stamp = OffsetDateTime.ofInstant(clock.instant(), ZoneOffset.UTC);
        String guard = author == ActorMemoryAuthor.ACTOR
                ? "true"
                : "actor_memory_entries.written_by <> 'actor'";
        return transaction.execute(status -> {
            List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                    WITH upserted AS (
                        INSERT INTO actor_memory_entries (
                            id,user_id,field,value,written_by,
                            source_practice_session_id,created_at,updated_at
                        )
                        VALUES (
                            :id,:userId,:field,:value,:author,
                            :sourcePracticeSessionId,:stamp,:stamp
                        )
                        ON CONFLICT ON CONSTRAINT uq_actor_memory_user_field DO UPDATE
                        SET value=EXCLUDED.value,
                            written_by=EXCLUDED.written_by,
                            source_practice_session_id=EXCLUDED.source_practice_session_id,
                            updated_at=EXCLUDED.updated_at
                        WHERE %s
                        RETURNING field,value,written_by,source_practice_session_id
                    )
                    SELECT field,value,written_by,source_practice_session_id FROM upserted
                    """.formatted(guard), Tuple.class)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("userId", userId)
                    .setParameter("field", field.dbValue())
                    .setParameter("value", value)
                    .setParameter("author", author.dbValue())
                    .setParameter("sourcePracticeSessionId", sourcePracticeSessionId)
                    .setParameter("stamp", stamp));
            return rows.isEmpty() ? null : entry(rows.getFirst());
        });
    }

    @Override
    public void delete(UUID userId, ActorMemoryField field) {
        transaction.executeWithoutResult(status -> {
            if (field == null) {
                entries.deleteAllByUserId(userId);
            } else {
                entries.deleteFieldByUserId(userId, field);
            }
        });
    }

    private static MemoryEntry entry(ActorMemoryEntryEntity entity) {
        return new MemoryEntry(
                entity.getField().dbValue(),
                entity.getValue(),
                entity.getWrittenBy() == ActorMemoryAuthor.ACTOR,
                entity.getSourcePracticeSessionId());
    }

    private static MemoryEntry entry(Tuple row) {
        return new MemoryEntry(
                row.get("field", String.class),
                row.get("value", String.class),
                "actor".equals(row.get("written_by", String.class)),
                row.get("source_practice_session_id", UUID.class));
    }


    // --- 코치가 대화를 시작할 때 알고 있어야 하는 지난 것들 -----------------------

    /**
     * 코치가 알고 시작해야 하는 지난 것들을 한 묶음으로 만든다.
     *
     * <p>배우에 대해 적어 둔 칸들과 {@link #priorContext}가 모아 오는 지난 대화·남은 숙제를 합친다 —
     * 코치는 그 셋이 어느 테이블에서 오는지 알 필요가 없다.
     */
    @Override
    public PriorContext priorFor(UUID userId, UUID practiceSessionId, UUID operationId) {
        Map<String, String> values = new LinkedHashMap<>();
        list(userId).forEach(row -> values.put(row.field(), row.value()));
        PriorPracticeContext context = priorContext(userId, practiceSessionId, operationId);
        return new PriorContext(
                values,
                context.earlierConversation(),
                context.fromSamePractice(),
                context.pendingTakes(),
                context.sceneHistory());
    }

    /** 지난 대화 발췌에 담는 마지막 턴 수. 여섯이면 배우·코치 세 왕복이다. */
    private static final int EXCERPT_TURNS = 6;

    /** 발췌 한 턴의 길이 상한. 프롬프트 쪽 전체 상한(1,200자)을 발췌가 다 먹지 않게 한다. */
    private static final int EXCERPT_TURN_CHARS = 120;

    /**
     * 같은 연습의 지난 대화와, 지난 연습에서 아직 안 해본 것.
     *
     * <p>지난 대화는 요약 칸이 아니라 <b>저장된 턴에서 발췌</b>한다. 요약 칸
     * ({@code conversation_summary})은 채우는 코드가 없어 늘 빈 값이었고, 그래서
     * "같은 연습 다시 열기"가 사실상 빈 껍데기였다 — dev 실측으로 닫힌 대화 5건
     * 전부 요약이 비어 있었다. 턴 원문은 이미 남아 있으므로 모델 호출 없이 진짜
     * 재료를 쓸 수 있고, 요약과 달리 지어낼 여지도 없다.
     */
    public PriorPracticeContext priorContext(UUID userId, UUID practiceSessionId) {
        return priorContext(userId, practiceSessionId, null);
    }

    private PriorPracticeContext priorContext(
            UUID userId, UUID practiceSessionId, UUID operationId) {
        List<UUID> closed = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT coach.id
                FROM coach_sessions coach
                JOIN practice_sessions practice ON practice.id=coach.practice_session_id
                WHERE coach.practice_session_id=:practiceSessionId
                  AND coach.status='closed'
                  AND practice.user_id=:userId
                ORDER BY coach.created_at DESC
                LIMIT 1
                """, Tuple.class)
                .setParameter("practiceSessionId", practiceSessionId)
                .setParameter("userId", userId)).stream()
                .map(row -> row.get("id", UUID.class))
                .toList();
        boolean samePractice = !closed.isEmpty();
        if (closed.isEmpty()) {
            // 배우가 끝난 연습의 카드에서 "이어서 새 연습" 을 눌러 시작했다면 그 연습의
            // 대화를 싣는다. 소유·숨김을 다시 확인한다 — 만들 때도 걸러지지만, 그 뒤에
            // 숨겨진 연습의 대화가 되살아나는 길을 여기서도 막는다.
            closed = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT coach.id
                    FROM practice_sessions current
                    JOIN practice_sessions member
                        ON member.id=current.continued_from
                        OR member.continued_from=current.continued_from
                    JOIN coach_sessions coach ON coach.practice_session_id=member.id
                    WHERE current.id=:practiceSessionId
                      AND member.user_id=:userId
                      AND member.hidden_at IS NULL
                      AND member.id <> current.id
                      AND coach.status='closed'
                    ORDER BY coach.created_at DESC
                    LIMIT 1
                    """, Tuple.class)
                    .setParameter("practiceSessionId", practiceSessionId)
                    .setParameter("userId", userId)).stream()
                    .map(row -> row.get("id", UUID.class))
                    .toList();
        }
        if (closed.isEmpty()) {
            // 새 영상으로 시작한 연습이다. 배우 입장에서 "이어하기" 는 같은 영상을
            // 다시 여는 것보다 새 영상을 올리며 지난 대화가 이어지는 쪽이므로,
            // 이 배우의 가장 최근 닫힌 대화를 대신 싣는다. 숨긴 연습은 뺀다 —
            // 배우가 지운 연습의 대화가 되살아나면 안 된다.
            closed = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT coach.id
                    FROM coach_sessions coach
                    JOIN practice_sessions practice ON practice.id=coach.practice_session_id
                    WHERE practice.user_id=:userId
                      AND practice.hidden_at IS NULL
                      AND coach.status='closed'
                    ORDER BY coach.created_at DESC
                    LIMIT 1
                    """, Tuple.class)
                    .setParameter("userId", userId)).stream()
                    .map(row -> row.get("id", UUID.class))
                    .toList();
        }
        String excerpt = closed.isEmpty() ? null : conversationExcerpt(closed.getFirst());
        // 가장 최근에 나온 카드. 이번 연습 것도 포함한다 — 같은 연습을 다시 열었다면
        // 그때 만든 카드가 바로 "지난번에 해보기로 한 것" 이다.
        List<String> report = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT card.report_json::text AS report_json
                FROM practice_reports card
                JOIN practice_sessions practice ON practice.id=card.practice_session_id
                WHERE practice.user_id=:userId AND practice.hidden_at IS NULL
                ORDER BY card.created_at DESC
                LIMIT 1
                """, Tuple.class)
                .setParameter("userId", userId)).stream()
                .map(row -> row.get("report_json", String.class))
                .toList();
        return new PriorPracticeContext(
                excerpt,
                samePractice,
                pendingTakes(report.isEmpty() ? null : report.getFirst(), operationId),
                sceneHistory(userId, practiceSessionId, operationId));
    }

    /**
     * 이어한 묶음(부모+자식들)에서 차수별 카드 한 줄 요약 (SOMA-418).
     *
     * <p>직전 대화 6턴만으로는 3~4차째에 처음 찾은 것을 잃는다. 카드는 그 연습의 요약을
     * 모델이 이미 정리해 둔 것이므로, 새 호출 없이 제목과 "아직 안 해본 것" 만 줄 세운다.
     * 카드가 없는 차수(차단 노트 포함)는 조용히 건너뛴다 — 빈 줄이 남으면 모델이 지어낸다.
     */
    private List<String> sceneHistory(
            UUID userId, UUID practiceSessionId, UUID operationId) {
        record Round(OffsetDateTime createdAt, String cardJson) {
        }
        List<Round> rounds = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT member.created_at, card.report_json::text AS card
                FROM practice_sessions current
                JOIN practice_sessions member
                    ON member.id=current.continued_from
                    OR member.continued_from=current.continued_from
                LEFT JOIN LATERAL (
                    SELECT report_json FROM practice_reports report
                    WHERE report.practice_session_id=member.id
                    ORDER BY report.created_at DESC LIMIT 1
                ) card ON TRUE
                WHERE current.id=:practiceSessionId
                  AND member.user_id=:userId
                  AND member.hidden_at IS NULL
                  AND member.id <> current.id
                ORDER BY member.created_at
                """, Tuple.class)
                .setParameter("practiceSessionId", practiceSessionId)
                .setParameter("userId", userId)).stream()
                .map(row -> new Round(
                        row.get("created_at", Instant.class).atOffset(ZoneOffset.UTC),
                        row.get("card", String.class)))
                .toList();
        List<String> lines = new ArrayList<>();
        for (Round round : rounds) {
            // 차수 번호는 살아남은 줄 기준으로 센다 — 카드 없는 차수를 건너뛰며 번호에
            // 구멍을 내면 코치가 없는 차수를 지어내 채운다.
            String line = historyLine(
                    lines.size() + 1, round.createdAt(), round.cardJson(), operationId);
            if (line != null) {
                lines.add(line);
            }
        }
        return List.copyOf(lines);
    }

    /** 차수 하나를 "N차(M/d): 제목 — 다음: …" 한 줄로. 카드 모양이 달라져도 터지지 않는다. */
    private String historyLine(
            int ordinal,
            OffsetDateTime createdAt,
            String cardJson,
            UUID operationId) {
        if (cardJson == null) {
            return null;
        }
        JsonNode card = parseStoredObject(
                cardJson, "PostgresMemoryRepository.sceneHistoryParse", operationId);
        if (card == null) {
            return null;
        }
        String title = card.path("title").asText("");
        if (title.isBlank()) {
            return null;
        }
        StringBuilder line = new StringBuilder();
        line.append(ordinal).append("차");
        if (createdAt != null) {
            OffsetDateTime seoul = createdAt.atZoneSameInstant(SEOUL).toOffsetDateTime();
            line.append('(').append(seoul.getMonthValue()).append('/')
                    .append(seoul.getDayOfMonth()).append(')');
        }
        line.append(": ").append(title);
        JsonNode nextTake = card.path("next_take");
        if (nextTake.isObject() && nextTake.path("tested").isBoolean()
                && !nextTake.path("tested").asBoolean()
                && nextTake.path("direction").isTextual()) {
            line.append(" — 다음: ").append(nextTake.path("direction").asText());
        }
        return line.toString();
    }

    /**
     * 닫힌 대화의 마지막 턴들을 "배우:/코치:" 줄로 발췌한다.
     *
     * <p>마지막 {@value #EXCERPT_TURNS}턴만 쓴다 — 대화의 끝이 그 연습에서 도달한
     * 지점이다. 턴 하나가 길면 {@value #EXCERPT_TURN_CHARS}자에서 자른다.
     */
    private String conversationExcerpt(UUID coachSessionId) {
        List<String> lines = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT role, text FROM (
                    SELECT turn.role, turn.text, turn.turn_index
                    FROM coach_turns turn
                    WHERE turn.session_id=:coachSessionId
                    ORDER BY turn.turn_index DESC
                    LIMIT %d
                ) latest ORDER BY latest.turn_index
                """.formatted(EXCERPT_TURNS), Tuple.class)
                .setParameter("coachSessionId", coachSessionId)).stream()
                .map(row -> {
            String speaker = "actor".equals(row.get("role", String.class)) ? "배우" : "코치";
            String text = PythonText.strip(row.get("text", String.class));
            if (text.codePointCount(0, text.length()) > EXCERPT_TURN_CHARS) {
                int end = text.offsetByCodePoints(0, EXCERPT_TURN_CHARS);
                text = text.substring(0, end).stripTrailing() + "…";
            }
            return speaker + ": " + text;
        }).toList();
        return lines.isEmpty() ? null : String.join("\n", lines);
    }

    /**
     * 카드에서 "해보기로 했지만 아직 안 해본 것" 만 꺼낸다 (`store.py:pending_takes_from_report`).
     *
     * <p>이미 해본 걸 또 권하면 코치가 대화를 안 듣고 있다는 인상을 준다. <b>카드 모양이
     * 달라져도 여기서 터지지 않는다</b> — 대화 시작이 이것 때문에 실패하면 안 된다.
     */
    private List<String> pendingTakes(String reportJson, UUID operationId) {
        if (reportJson == null) {
            return List.of();
        }
        JsonNode root = parseStoredObject(
                reportJson, "PostgresMemoryRepository.pendingTakesParse", operationId);
        if (root == null) {
            return List.of();
        }
        List<String> takes = new ArrayList<>();
        JsonNode nextTake = root.get("next_take");
        if (nextTake != null && nextTake.isObject() && nextTake.path("tested").isBoolean()
                && !nextTake.path("tested").asBoolean()) {
            add(takes, nextTake.get("direction"));
        }
        JsonNode training = root.get("actor_training");
        if (training != null && training.isArray()) {
            for (JsonNode item : training) {
                if (item.isObject() && item.path("tested").isBoolean()
                        && !item.path("tested").asBoolean()) {
                    add(takes, item.get("title"));
                }
            }
        }
        return List.copyOf(takes);
    }

    private JsonNode parseStoredObject(
            String rawJson, String reportLocation, UUID operationId) {
        JsonNode parsed;
        try {
            parsed = mapper.readTree(rawJson);
        } catch (JsonProcessingException notJson) {
            reportStoredJsonFailure(notJson, reportLocation, operationId);
            return null;
        }
        if (parsed == null || parsed.isMissingNode() || !parsed.isObject()) {
            reportStoredJsonFailure(
                    new IllegalStateException("stored report is not a JSON object"),
                    reportLocation,
                    operationId);
            return null;
        }
        return parsed;
    }

    private void reportStoredJsonFailure(
            Throwable failure, String reportLocation, UUID operationId) {
        failureReporter.report(
                failure,
                FailureKind.UNEXPECTED,
                new FailureContext(reportLocation, operationId));
    }

    private static void add(List<String> takes, JsonNode value) {
        if (value != null && value.isTextual()) {
            String stripped = PythonText.strip(value.asText());
            if (!stripped.isEmpty()) {
                takes.add(stripped);
            }
        }
    }

    /**
     * 배우가 마무리까지 간 연습이 몇 번인지 (`store.py:count_confirmed_practices`).
     * 기억을 몇 번에 한 번 갱신할지 판정하는 데 쓴다.
     */
    @Override
    public long countConfirmedPractices(UUID userId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT count(*) AS confirmed_count
                FROM handoff_confirmations confirmation
                JOIN coaching_handoffs handoff ON handoff.id=confirmation.coaching_handoff_id
                JOIN coach_sessions coach ON coach.id=handoff.coach_session_id
                JOIN practice_sessions practice ON practice.id=coach.practice_session_id
                WHERE practice.user_id=:userId AND confirmation.confirmed IS TRUE
                """, Tuple.class)
                .setParameter("userId", userId));
        return rows.isEmpty() ? 0L : rows.getFirst().get("confirmed_count", Long.class);
    }

    /**
     * 기억 갱신을 뒤에서 돌도록 큐에 넣는다 (`store.py:enqueue_memory_update`).
     *
     * <p>{@code request_id} 를 연습에서 만들어내므로 같은 연습으로 두 번 들어와도 잡은
     * 하나다. 연습 마무리는 재시도될 수 있고, 그때마다 갱신을 다시 돌리면 모델 호출만 는다.
     */
    @Override
    public boolean enqueueMemoryUpdate(UUID userId, UUID practiceSessionId) {
        UUID requestId = uuid5(MEMORY_UPDATE_NAMESPACE, practiceSessionId.toString());
        String fingerprint = sha256Hex("memory_update:" + practiceSessionId);
        return Boolean.TRUE.equals(transaction.execute(status ->
                !NativeTuples.list(entityManager.createNativeQuery("""
                        WITH inserted AS (
                            INSERT INTO external_operations (
                                id,session_id,user_id,request_id,kind,request_fingerprint
                            )
                            VALUES (
                                :id,:practiceSessionId,:userId,:requestId,
                                'memory_update',:fingerprint
                            )
                            ON CONFLICT (user_id,request_id) DO NOTHING
                            RETURNING id
                        )
                        SELECT id FROM inserted
                        """, Tuple.class)
                        .setParameter("id", UUID.randomUUID())
                        .setParameter("practiceSessionId", practiceSessionId)
                        .setParameter("userId", userId)
                        .setParameter("requestId", requestId)
                        .setParameter("fingerprint", fingerprint)).isEmpty()));
    }

    /**
     * 기억 갱신 잡이 읽을 재료 (`store.py:get_memory_update_material`).
     *
     * <p><b>배우가 한 말만 담는다</b> — 코치가 한 말까지 넣으면 코치가 제안한 표현이
     * 배우 본인의 말로 굳어 기억에 남는다.
     */
    @Override
    public MemoryUpdateMaterial material(UUID practiceSessionId) {
        List<MemoryUpdateMaterial> sessions = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT user_id,goal,blockage_kind,sub_branch,blockage_detail
                FROM practice_sessions
                WHERE id=:practiceSessionId AND hidden_at IS NULL
                """, Tuple.class)
                .setParameter("practiceSessionId", practiceSessionId)).stream()
                .map(row -> new MemoryUpdateMaterial(
                        row.get("user_id", UUID.class),
                        practiceSessionId,
                        row.get("goal", String.class),
                        row.get("blockage_kind", String.class),
                        row.get("sub_branch", String.class),
                        row.get("blockage_detail", String.class),
                        List.of(),
                        List.of()))
                .toList();
        if (sessions.isEmpty()) {
            return null;
        }
        List<String> transcripts = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT text AS text
                FROM transcripts
                WHERE session_id=:practiceSessionId
                ORDER BY ord
                """, Tuple.class)
                .setParameter("practiceSessionId", practiceSessionId)).stream()
                .map(row -> row.get("text", String.class))
                .toList();
        List<String> actorMessages = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT turn.text
                FROM coach_turns turn
                JOIN coach_sessions coach ON coach.id=turn.session_id
                WHERE coach.practice_session_id=:practiceSessionId AND turn.role='actor'
                ORDER BY turn.turn_index
                """, Tuple.class)
                .setParameter("practiceSessionId", practiceSessionId)).stream()
                .map(row -> row.get("text", String.class))
                .toList();
        MemoryUpdateMaterial session = sessions.getFirst();
        return new MemoryUpdateMaterial(
                session.userId(), practiceSessionId, session.goal(), session.blockageKind(),
                session.subBranch(), session.blockageDetail(), transcripts, actorMessages);
    }

    /** 셋 다 비어 있을 수 있다 — 첫 연습이 그렇다. */
    public record PriorPracticeContext(
            String earlierConversation, boolean fromSamePractice, List<String> pendingTakes,
            List<String> sceneHistory) {
    }


    /**
     * RFC 4122 v5 (SHA-1). {@code UUID.nameUUIDFromBytes} 는 v3(MD5)라 파이썬
     * {@code uuid5} 와 다른 값이 나온다 — 같은 연습이 두 잡이 되어 멱등이 깨진다.
     */
    static UUID uuid5(UUID namespace, String name) {
        MessageDigest sha1 = digest("SHA-1");
        ByteBuffer namespaceBytes = ByteBuffer.allocate(16);
        namespaceBytes.putLong(namespace.getMostSignificantBits());
        namespaceBytes.putLong(namespace.getLeastSignificantBits());
        sha1.update(namespaceBytes.array());
        sha1.update(name.getBytes(StandardCharsets.UTF_8));
        byte[] hash = sha1.digest();
        hash[6] &= 0x0f;
        hash[6] |= 0x50;
        hash[8] &= 0x3f;
        hash[8] |= (byte) 0x80;
        ByteBuffer buffer = ByteBuffer.wrap(hash, 0, 16);
        return new UUID(buffer.getLong(), buffer.getLong());
    }

    private static String sha256Hex(String value) {
        byte[] hash = digest("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder(hash.length * 2);
        for (byte octet : hash) {
            hex.append("%02x".formatted(octet));
        }
        return hex.toString();
    }

    private static MessageDigest digest(String algorithm) {
        try {
            return MessageDigest.getInstance(algorithm);
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(algorithm + " 을 쓸 수 없다", impossible);
        }
    }
}
