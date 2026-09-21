package com.acttub.actingapi.feature.coach.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.ActorProfile;
import com.acttub.actingapi.feature.coach.app.CoachSessionSnapshot;
import com.acttub.actingapi.feature.coach.app.ConversationRepository;
import com.acttub.actingapi.feature.coach.app.PriorContext;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 1.0.0 코치 대화의 저장소. 엔진이 쓰는 {@link CoachSessionSnapshot} 을 {@code practices}·{@code analyses}·
 * {@code videos}·{@code coach_conversations}·{@code coach_messages} 에서 만들어 준다 — 그래야 행동 규칙(상한·첫 응답·
 * 상태 json)을 그대로 쓰면서 저장만 새 표로 옮길 수 있다.
 *
 * <p><b>쓰기는 대화 행을 잠그고 {@code state_revision} 을 다시 본다.</b> 바깥 호출(LLM)이 도는 사이에 다른 요청이
 * 저장했으면 이번 저장은 아무것도 쓰지 않는다(409 {@code conversation_conflict}).
 */
@Repository
class PostgresConversationRepository implements ConversationRepository {
    private static final ObjectMapper JSON = new ObjectMapper();

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresConversationRepository(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Loaded loadByPractice(UUID userId, UUID practiceId) {
        return load(userId, "p.id=:id", practiceId);
    }

    @Override
    public Loaded loadByConversation(UUID userId, UUID conversationId) {
        return load(userId, "c.id=:id", conversationId);
    }

    private Loaded load(UUID userId, String where, UUID id) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT p.id AS practice_id,p.user_id,p.stage,p.situation,p.character_context,p.goal,
                       p.blockage_kind,p.sub_branch,p.blockage_detail,p.experience_version,
                       v.duration_ms,
                       a.id AS analysis_id,CAST(a.record AS text) AS record,
                       c.id AS conversation_id,c.start_request_id,c.status,c.close_reason,
                       c.state_revision,CAST(c.state AS text) AS state
                FROM practices p
                JOIN videos v ON v.id=p.video_id
                LEFT JOIN analyses a ON a.practice_id=p.id
                LEFT JOIN coach_conversations c ON c.practice_id=p.id
                WHERE %s
                  AND p.user_id=:userId
                """.formatted(where), Tuple.class)
                .setParameter("id", id)
                .setParameter("userId", userId));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        UUID conversationId = row.get("conversation_id", UUID.class);
        UUID practiceId = row.get("practice_id", UUID.class);
        Number revision = (Number) row.get("state_revision");
        return new Loaded(
                practiceId,
                conversationId,
                row.get("start_request_id", UUID.class),
                row.get("stage", String.class),
                new CoachSessionSnapshot(
                        conversationId == null ? UUID.randomUUID() : conversationId,
                        practiceId,
                        row.get("analysis_id", UUID.class),
                        userId,
                        json(row.get("record", String.class)),
                        row.get("situation", String.class),
                        row.get("character_context", String.class),
                        row.get("goal", String.class),
                        row.get("duration_ms", Integer.class),
                        row.get("blockage_kind", String.class),
                        row.get("sub_branch", String.class),
                        row.get("blockage_detail", String.class),
                        // 받아쓰기는 관찰 기록 안의 speech 로 들어간다 — 옛 흐름의 문장 목록과 달리 따로 싣지 않는다.
                        List.of(),
                        "",
                        null,
                        row.get("status", String.class) == null ? "open" : row.get("status", String.class),
                        row.get("close_reason", String.class),
                        conversationId == null ? List.of() : turnsOf(conversationId),
                        PriorContext.EMPTY,
                        row.get("experience_version", String.class),
                        revision == null ? 0L : revision.longValue(),
                        json(row.get("state", String.class)),
                        (ActorProfile) null));
    }

    private List<CoachTurnSnapshot> turnsOf(UUID conversationId) {
        return NativeTuples.list(entityManager.createNativeQuery("""
                SELECT role,text FROM coach_messages
                WHERE conversation_id=:conversationId
                ORDER BY turn_index
                """, Tuple.class)
                .setParameter("conversationId", conversationId)).stream()
                .map(row -> new CoachTurnSnapshot(row.get("role", String.class), row.get("text", String.class)))
                .toList();
    }

    @Override
    public UUID open(UUID practiceId, UUID startRequestId, Instant now) {
        return transaction.execute(tx -> {
            UUID id = UUID.randomUUID();
            entityManager.createNativeQuery("""
                    INSERT INTO coach_conversations(id,practice_id,start_request_id,status,created_at,updated_at)
                    VALUES (:id,:practiceId,:startRequestId,'open',:now,:now)
                    ON CONFLICT (practice_id) DO NOTHING
                    """)
                    .setParameter("id", id)
                    .setParameter("practiceId", practiceId)
                    .setParameter("startRequestId", startRequestId)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .executeUpdate();
            return (UUID) entityManager.createNativeQuery(
                    "SELECT id FROM coach_conversations WHERE practice_id=:practiceId")
                    .setParameter("practiceId", practiceId)
                    .getSingleResult();
        });
    }

    @Override
    public void saveOpening(UUID conversationId, String coachMessage, JsonNode state, Instant now) {
        transaction.executeWithoutResult(tx -> {
            Number turns = (Number) entityManager.createNativeQuery(
                    "SELECT count(*) FROM coach_messages WHERE conversation_id=:conversationId")
                    .setParameter("conversationId", conversationId)
                    .getSingleResult();
            if (turns.intValue() > 0) {
                return;
            }
            insertMessage(conversationId, 0, "ai", coachMessage, null, null, now);
            entityManager.createNativeQuery("""
                    UPDATE coach_conversations
                    SET state=CAST(:state AS jsonb),state_revision=state_revision+1,updated_at=:now
                    WHERE id=:conversationId
                    """)
                    .setParameter("state", state == null ? "{}" : text(state))
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("conversationId", conversationId)
                    .executeUpdate();
        });
    }

    @Override
    public Replay findReplay(UUID conversationId, UUID requestId, String fingerprint) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT m.turn_index,m.request_fingerprint,c.status,c.close_reason,c.state_revision,
                       (SELECT text FROM coach_messages later
                        WHERE later.conversation_id=m.conversation_id
                          AND later.turn_index>m.turn_index
                          AND later.role='ai'
                        ORDER BY later.turn_index
                        LIMIT 1) AS coach_message
                FROM coach_messages m
                JOIN coach_conversations c ON c.id=m.conversation_id
                WHERE m.conversation_id=:conversationId
                  AND m.request_id=:requestId
                """, Tuple.class)
                .setParameter("conversationId", conversationId)
                .setParameter("requestId", requestId));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        String stored = row.get("request_fingerprint", String.class);
        if (stored != null && !fingerprint.equals(stored.strip())) {
            return new Replay(true, null, null, null, 0L);
        }
        return new Replay(
                false,
                row.get("coach_message", String.class),
                row.get("status", String.class),
                row.get("close_reason", String.class),
                ((Number) row.get("state_revision")).longValue());
    }

    @Override
    public Saved appendTurn(
            UUID conversationId,
            long expectedRevision,
            UUID requestId,
            String fingerprint,
            String actorText,
            String coachMessage,
            JsonNode state,
            String status,
            String closeReason,
            Instant now) {
        return transaction.execute(tx -> {
            // 대화 행과 함께 계정 상태를 본다 — 바깥 호출이 도는 사이에 다른 기기의 탈퇴가 끝났으면 그 뒤에
            // 도착한 코치 응답을 저장하지 않는다(practice.coach, 02-practice 「이관·삭제·탈퇴」). 분석의
            // `PostgresPracticeAnalysisStore.complete` 가 같은 자리에서 같은 확인을 한다.
            List<Tuple> locked = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT c.state_revision,c.status,u.status AS account_status
                    FROM coach_conversations c
                    JOIN practices p ON p.id=c.practice_id
                    JOIN users u ON u.id=p.user_id
                    WHERE c.id=:conversationId
                    FOR UPDATE OF c
                    """, Tuple.class)
                    .setParameter("conversationId", conversationId));
            if (locked.isEmpty()) {
                return null;
            }
            Tuple row = locked.getFirst();
            if (!"active".equals(row.get("account_status", String.class))) {
                throw new OwnerNotActive();
            }
            // 바깥 호출이 도는 사이에 다른 요청이 저장했으면 이번 것은 쓰지 않는다.
            if (((Number) row.get("state_revision")).longValue() != expectedRevision
                    || !"open".equals(row.get("status", String.class))) {
                return null;
            }
            int nextIndex = ((Number) entityManager.createNativeQuery(
                    "SELECT COALESCE(max(turn_index)+1,0) FROM coach_messages WHERE conversation_id=:conversationId")
                    .setParameter("conversationId", conversationId)
                    .getSingleResult()).intValue();
            insertMessage(conversationId, nextIndex, "actor", actorText, requestId, fingerprint, now);
            insertMessage(conversationId, nextIndex + 1, "ai", coachMessage, null, null, now);
            entityManager.createNativeQuery("""
                    UPDATE coach_conversations
                    SET state=CAST(:state AS jsonb),state_revision=state_revision+1,
                        status=CAST(:status AS text),close_reason=CAST(:closeReason AS text),
                        closed_at=CASE WHEN CAST(:status AS text)='closed' THEN :now ELSE closed_at END,
                        updated_at=:now
                    WHERE id=:conversationId
                    """)
                    .setParameter("state", state == null ? "{}" : text(state))
                    .setParameter("status", status)
                    .setParameter("closeReason", closeReason)
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .setParameter("conversationId", conversationId)
                    .executeUpdate();
            int coachReplies = ((Number) entityManager.createNativeQuery("""
                    SELECT count(*) FROM coach_messages
                    WHERE conversation_id=:conversationId AND role='ai'
                    """)
                    .setParameter("conversationId", conversationId)
                    .getSingleResult()).intValue();
            return new Saved(expectedRevision + 1, status, closeReason, coachReplies);
        });
    }

    private void insertMessage(
            UUID conversationId, int turnIndex, String role, String text, UUID requestId, String fingerprint,
            Instant now) {
        entityManager.createNativeQuery("""
                INSERT INTO coach_messages(id,conversation_id,turn_index,role,text,request_id,request_fingerprint,created_at)
                VALUES (:id,:conversationId,:turnIndex,:role,:text,CAST(:requestId AS uuid),
                        CAST(:fingerprint AS bpchar),:now)
                """)
                .setParameter("id", UUID.randomUUID())
                .setParameter("conversationId", conversationId)
                .setParameter("turnIndex", turnIndex)
                .setParameter("role", role)
                .setParameter("text", text == null ? "" : text)
                .setParameter("requestId", requestId)
                .setParameter("fingerprint", fingerprint)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                .executeUpdate();
    }

    @Override
    public NoteView saveNote(UUID conversationId, NewNote note, Instant now) {
        return transaction.execute(tx -> {
            entityManager.createNativeQuery("""
                    INSERT INTO coach_notes(id,conversation_id,format,kind,title,summary_quotes,next_take,
                                            actor_words,corrections,tags,fallback,source_revision,legacy_report,created_at)
                    VALUES (CAST(:id AS uuid),CAST(:conversationId AS uuid),CAST(:format AS text),
                            CAST(:kind AS text),CAST(:title AS text),CAST(:quotes AS jsonb),
                            CAST(:nextTake AS text),CAST(:actorWords AS jsonb),CAST(:corrections AS jsonb),
                            CAST(:tags AS jsonb),CAST(:fallback AS boolean),CAST(:sourceRevision AS integer),
                            CAST(:legacyReport AS jsonb),:now)
                    ON CONFLICT (conversation_id) DO NOTHING
                    """)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("conversationId", conversationId)
                    .setParameter("format", note.format())
                    .setParameter("kind", note.kind())
                    .setParameter("title", note.title())
                    .setParameter("quotes", text(note.summaryQuotes()))
                    .setParameter("nextTake", note.nextTake())
                    .setParameter("actorWords", text(note.actorWords()))
                    .setParameter("corrections", text(note.corrections()))
                    .setParameter("tags", text(note.tags()))
                    .setParameter("fallback", note.fallback())
                    .setParameter("sourceRevision", note.sourceRevision())
                    // jsonb 파라미터에 SQL NULL 을 바인딩하면 드라이버가 타입을 추론하지 못한다 — JSON null 로 넘긴다.
                    .setParameter("legacyReport", note.legacyReport() == null ? "null" : text(note.legacyReport()))
                    .setParameter("now", now.atOffset(ZoneOffset.UTC))
                    .executeUpdate();
            return noteOf("n.conversation_id=:id", conversationId);
        });
    }

    @Override
    public NoteView note(UUID userId, UUID practiceId) {
        List<Tuple> owned = NativeTuples.list(entityManager.createNativeQuery(
                "SELECT id FROM practices WHERE id=:practiceId AND user_id=:userId", Tuple.class)
                .setParameter("practiceId", practiceId)
                .setParameter("userId", userId));
        if (owned.isEmpty()) {
            return legacyNote(userId, practiceId);
        }
        NoteView note = noteOf("c.practice_id=:id", practiceId);
        return note == null ? legacyNote(userId, practiceId) : note;
    }

    /**
     * 아직 옮기지 않은 옛 노트를 <b>새 봉투에 담아</b> 낸다 (02-practice ②).
     *
     * <p>기존 갈래는 {@code legacy} 형식에 옛 종류(analysis·expression)를 그대로 두고, 신형 노트만 {@code v2}
     * 다 — 이름만 바꾸지 않는다. 원문은 {@code report} 로 그대로 나가 옛 공개 필드를 읽던 화면이 그대로 쓴다.
     * 요약 인용은 비어 있다: 옛 원문에는 발췌와 출처의 짝이 남아 있지 않다.
     */
    private NoteView legacyNote(UUID userId, UUID practiceId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT r.id,h.coach_session_id AS conversation_id,r.report_type,r.report_json::text AS report,
                       COALESCE(h.state_revision,0) AS source_revision,r.created_at
                FROM practice_reports r
                JOIN coaching_handoffs h ON h.id=r.source_handoff_id
                JOIN practice_sessions ps ON ps.id=r.practice_session_id
                WHERE r.practice_session_id=:practiceId
                  AND ps.user_id=:userId
                ORDER BY r.created_at DESC,r.id DESC
                LIMIT 1
                """, Tuple.class)
                .setParameter("practiceId", practiceId)
                .setParameter("userId", userId));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        JsonNode report = json(row.get("report", String.class));
        boolean modern = "practice_note".equals(row.get("report_type", String.class));
        String mode = report.path("mode").asText("record_only");
        return new NoteView(
                row.get("id", UUID.class),
                row.get("conversation_id", UUID.class),
                modern ? "v2" : "legacy",
                modern ? mode : row.get("report_type", String.class),
                modern
                        ? ("record_only".equals(mode) ? null : plain(report.path("copy").path("title")))
                        : plain(report.path("title")),
                JSON.createArrayNode(),
                modern ? plain(report.path("practice").path("instruction")) : null,
                JSON.createArrayNode(),
                JSON.createArrayNode(),
                JSON.createArrayNode(),
                false,
                ((Number) row.get("source_revision")).longValue(),
                report,
                row.get("created_at", Instant.class));
    }

    /** 비어 있는 JSON 값은 {@code null} 이다 — 옛 원문의 빈 제목을 빈 문자열로 내보내지 않는다. */
    private static String plain(JsonNode value) {
        return value == null || value.isMissingNode() || value.isNull() || value.asText().isBlank()
                ? null
                : value.asText();
    }

    private NoteView noteOf(String where, UUID id) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT n.id,n.conversation_id,n.format,n.kind,n.title,CAST(n.summary_quotes AS text) AS summary_quotes,
                       n.next_take,CAST(n.actor_words AS text) AS actor_words,
                       CAST(n.corrections AS text) AS corrections,CAST(n.tags AS text) AS tags,
                       n.fallback,n.source_revision,CAST(n.legacy_report AS text) AS legacy_report,n.created_at
                FROM coach_notes n
                JOIN coach_conversations c ON c.id=n.conversation_id
                WHERE %s
                """.formatted(where), Tuple.class)
                .setParameter("id", id));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        return new NoteView(
                row.get("id", UUID.class),
                row.get("conversation_id", UUID.class),
                row.get("format", String.class),
                row.get("kind", String.class),
                row.get("title", String.class),
                json(row.get("summary_quotes", String.class)),
                row.get("next_take", String.class),
                json(row.get("actor_words", String.class)),
                json(row.get("corrections", String.class)),
                json(row.get("tags", String.class)),
                row.get("fallback", Boolean.class),
                ((Number) row.get("source_revision")).longValue(),
                json(row.get("legacy_report", String.class)),
                row.get("created_at", Instant.class));
    }

    @Override
    public ConversationView conversation(UUID userId, UUID conversationId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT c.id,c.practice_id,c.status,c.close_reason,c.state_revision,c.created_at
                FROM coach_conversations c
                JOIN practices p ON p.id=c.practice_id
                WHERE c.id=:conversationId
                  AND p.user_id=:userId
                """, Tuple.class)
                .setParameter("conversationId", conversationId)
                .setParameter("userId", userId));
        if (rows.isEmpty()) {
            return legacyConversation(userId, conversationId);
        }
        Tuple row = rows.getFirst();
        List<Turn> turns = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT turn_index,role,text,created_at FROM coach_messages
                WHERE conversation_id=:conversationId
                ORDER BY turn_index
                """, Tuple.class)
                .setParameter("conversationId", conversationId)).stream()
                .map(turn -> new Turn(
                        turn.get("turn_index", Integer.class),
                        // 저장은 옛 값과 같은 `ai` 이고 화면에는 `coach` 로 보인다.
                        "ai".equals(turn.get("role", String.class)) ? "coach" : turn.get("role", String.class),
                        turn.get("text", String.class),
                        turn.get("created_at", Instant.class)))
                .toList();
        return new ConversationView(
                row.get("id", UUID.class),
                row.get("practice_id", UUID.class),
                row.get("status", String.class),
                row.get("close_reason", String.class),
                ((Number) row.get("state_revision")).longValue(),
                row.get("created_at", Instant.class),
                turns);
    }

    private static JsonNode json(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return JSON.readTree(raw);
        } catch (Exception unreadable) {
            return null;
        }
    }

    private static String text(JsonNode value) {
        try {
            return value == null ? null : JSON.writeValueAsString(value);
        } catch (Exception failure) {
            throw new IllegalStateException("failed to write conversation json", failure);
        }
    }

    /**
     * 아직 옮기지 않은 옛 대화 (02-practice ②). <b>한 연습에 대화가 여럿인 옛 자료</b>의 "이전 대화" 가 이
     * 경로로 열린다 — 최근 하나로 자르지 않는다(practice.coach).
     *
     * <p>종료 사유는 옛 어휘를 그대로 낸다. 전환 명령은 새 어휘로 옮기지만, 여기서 읽는 것은 아직 옛 표에
     * 있는 행이고 그 행의 값을 고쳐 보이지 않는다.
     */
    private ConversationView legacyConversation(UUID userId, UUID conversationId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT cs.id,cs.practice_session_id,cs.status::text AS status,
                       cs.close_reason::text AS close_reason,cs.state_revision,cs.created_at
                FROM coach_sessions cs
                JOIN practice_sessions ps ON ps.id=cs.practice_session_id
                WHERE cs.id=:conversationId
                  AND ps.user_id=:userId
                """, Tuple.class)
                .setParameter("conversationId", conversationId)
                .setParameter("userId", userId));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        List<Turn> turns = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT turn_index,role::text AS role,text,created_at FROM coach_turns
                WHERE session_id=:conversationId
                ORDER BY turn_index
                """, Tuple.class)
                .setParameter("conversationId", conversationId)).stream()
                .map(turn -> new Turn(
                        turn.get("turn_index", Integer.class),
                        "ai".equals(turn.get("role", String.class)) ? "coach" : turn.get("role", String.class),
                        turn.get("text", String.class),
                        turn.get("created_at", Instant.class)))
                .toList();
        return new ConversationView(
                row.get("id", UUID.class),
                row.get("practice_session_id", UUID.class),
                row.get("status", String.class),
                row.get("close_reason", String.class),
                ((Number) row.get("state_revision")).longValue(),
                row.get("created_at", Instant.class),
                turns);
    }
}
