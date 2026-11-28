package com.acttub.actingapi.feature.coach.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountRowLock;
import com.acttub.actingapi.feature.coach.app.ActorProfile;
import com.acttub.actingapi.feature.coach.app.CoachSessionSnapshot;
import com.acttub.actingapi.feature.coach.app.ConversationRepository;
import com.acttub.actingapi.feature.coach.app.PriorContext;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.feature.practice.app.PracticeStageTransitions;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import com.acttub.actingapi.platform.json.LenientJson;
import tools.jackson.databind.json.JsonMapper;

/**
 * 0.1.0 코치 대화의 저장소. 엔진이 쓰는 {@link CoachSessionSnapshot} 을 {@code practices}·{@code analyses}·
 * {@code videos}·{@code coach_conversations}·{@code coach_messages} 에서 만들어 준다 — 그래야 행동 규칙(상한·첫 응답·
 * 상태 json)을 그대로 쓰면서 저장만 새 표로 옮길 수 있다.
 *
 * <p><b>쓰기는 대화 행을 잠그고 {@code state_revision} 을 다시 본다.</b> 바깥 호출(LLM)이 도는 사이에 다른 요청이
 * 저장했으면 이번 저장은 아무것도 쓰지 않는다(409 {@code conversation_conflict}).
 */
@Repository
class PostgresConversationRepository implements ConversationRepository {
    private static final ObjectMapper JSON = JsonMapper.builderWithJackson2Defaults().build();

    private final EntityManager entityManager;
    private final CoachConversationJpaRepository conversations;
    private final CoachMessageJpaRepository messages;
    private final CoachNoteJpaRepository notes;
    private final TransactionTemplate transaction;
    private final PracticeStageTransitions stages;

    private final AccountRowLock accountRows;

    PostgresConversationRepository(EntityManager entityManager, CoachConversationJpaRepository conversations,
            CoachMessageJpaRepository messages, CoachNoteJpaRepository notes,
            PlatformTransactionManager transactionManager, PracticeStageTransitions stages,
            AccountRowLock accountRows) {
        this.accountRows = accountRows;
        this.stages = stages;
        this.entityManager = entityManager;
        this.conversations = conversations;
        this.messages = messages;
        this.notes = notes;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    /**
     * 코치가 읽는 세션 목적. 영상 없이 말로 하는 회차(SOMA-745)는 목적 앞에 말 표시({@code talk:})를 붙인다 — 코치는 이 표시로
     * 영상 없는 갈래를 탄다({@code PurposeLoop}). 저장된 값과 API 의 목적은 붙이지 않은 그대로다.
     */
    private static final String SESSION_PURPOSE =
            // 리딩 녹음으로 시작한 회차(SOMA-791, reading)는 영상이 없어도 말 표시를 붙이지 않는다 — 소리를 듣는 따로 된 갈래다.
            "CASE WHEN p.video_id IS NULL AND p.session_purpose IS NOT NULL AND p.session_purpose<>'reading'"
            + " THEN 'talk:' || p.session_purpose ELSE p.session_purpose END";

    @Override
    public Loaded loadByPractice(UUID userId, UUID practiceId) {
        return load(userId, "p.id=:id", practiceId);
    }

    @Override
    public Loaded loadByConversation(UUID userId, UUID conversationId) {
        return load(userId, "c.id=:id", conversationId);
    }

    @Override
    public String practiceLanguage(UUID userId, UUID practiceId) {
        List<?> rows = entityManager.createNativeQuery(
                        "SELECT language FROM practices WHERE id=:id AND user_id=:userId")
                .setParameter("id", practiceId)
                .setParameter("userId", userId)
                .getResultList();
        return rows.isEmpty() ? null : (String) rows.getFirst();
    }

    private Loaded load(UUID userId, String where, UUID id) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT p.id AS practice_id,p.user_id,p.stage,p.situation,p.character_context,p.goal,
                       p.blockage_kind,p.sub_branch,p.blockage_detail,p.experience_version,
                       %s AS session_purpose,
                       v.duration_ms,
                       CAST(a.record AS text) AS record,
                       c.id AS conversation_id,c.status,c.close_reason,
                       c.state_revision,CAST(c.state AS text) AS state
                FROM practices p
                LEFT JOIN videos v ON v.id=p.video_id
                LEFT JOIN analyses a ON a.practice_id=p.id
                LEFT JOIN coach_conversations c ON c.practice_id=p.id
                WHERE %s
                  AND p.user_id=:userId
                """.formatted(SESSION_PURPOSE, where), Tuple.class)
                .setParameter("id", id)
                .setParameter("userId", userId));
        if (rows.isEmpty()) {
            return null;
        }
        Tuple row = rows.getFirst();
        UUID conversationId = row.get("conversation_id", UUID.class);
        UUID practiceId = row.get("practice_id", UUID.class);
        Number revision = (Number) row.get("state_revision");
        JsonNode state = json(row.get("state", String.class));
        // 새 행의 DB 기본값 {}는 아직 대화를 시작하지 않았다는 뜻이다. 엔진은 null을 받아야
        // 첫 상태를 조립한다. 진행된 상태의 손상을 빈 대화로 바꾸지는 않는다.
        if (state != null && state.isObject() && state.isEmpty() && revision.longValue() == 0) {
            state = null;
        }
        return new Loaded(
                practiceId,
                conversationId,
                row.get("stage", String.class),
                new CoachSessionSnapshot(
                        conversationId == null ? UUID.randomUUID() : conversationId,
                        practiceId,
                        userId,
                        json(row.get("record", String.class)),
                        row.get("situation", String.class),
                        row.get("character_context", String.class),
                        row.get("goal", String.class),
                        row.get("duration_ms", Integer.class) == null ? 0 : row.get("duration_ms", Integer.class),
                        row.get("blockage_kind", String.class),
                        row.get("sub_branch", String.class),
                        row.get("blockage_detail", String.class),
                        row.get("status", String.class) == null ? "open" : row.get("status", String.class),
                        row.get("close_reason", String.class),
                        conversationId == null ? List.of() : turnsOf(conversationId),
                        PriorContext.EMPTY,
                        row.get("experience_version", String.class),
                        revision == null ? 0L : revision.longValue(),
                        state,
                        (ActorProfile) null,
                        row.get("session_purpose", String.class)));
    }

    private List<CoachTurnSnapshot> turnsOf(UUID conversationId) {
        return messages.spoken(conversationId).stream()
                .map(turn -> new CoachTurnSnapshot(turn.getRole(), turn.getText()))
                .toList();
    }

    @Override
    public UUID open(UUID practiceId, UUID startRequestId, Instant now) {
        return transaction.execute(tx -> {
            conversations.open(UUID.randomUUID(), practiceId, startRequestId, now);
            return conversations.ofPractice(practiceId);
        });
    }

    @Override
    public void saveOpening(UUID conversationId, String coachMessage, JsonNode state, String closeReason, Instant now) {
        transaction.executeWithoutResult(tx -> {
            if (!lockActiveOwner(conversationId)) return;
            conversations.lock(conversationId);
            if (messages.turns(conversationId) > 0) {
                return;
            }
            insertMessage(conversationId, 0, "ai", coachMessage, null, null, now);
            conversations.saveOpening(conversationId, state == null ? "{}" : text(state), closeReason, now);
            if (closeReason != null) {
                stages.conversationClosed(conversationId, now);
            }
        });
    }

    @Override
    public Replay findReplay(UUID conversationId, UUID requestId, String fingerprint) {
        CoachMessageJpaRepository.Replayed row = messages.replayed(conversationId, requestId).orElse(null);
        if (row == null) {
            return null;
        }
        String stored = row.getRequestFingerprint();
        if (stored != null && !fingerprint.equals(stored.strip())) {
            return new Replay(true, null, null, null, 0L, 0);
        }
        long laterReplies = row.getLaterReplies();
        return new Replay(
                false,
                row.getCoachMessage(),
                laterReplies == 0 ? row.getStatus() : "open",
                laterReplies == 0 ? row.getCloseReason() : null,
                row.getStateRevision() - laterReplies,
                (int) row.getResponseTurnCount());
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
            if (!lockActiveOwner(conversationId)) return null;
            // 대화 행과 함께 계정 상태를 본다 — 바깥 호출이 도는 사이에 다른 기기의 탈퇴가 끝났으면 그 뒤에
            // 도착한 코치 응답을 저장하지 않는다(practice.coach, specs/practice 「이관·삭제·탈퇴」). 분석의
            // `PostgresPracticeAnalysisStore.complete` 가 같은 자리에서 같은 확인을 한다.
            CoachConversationJpaRepository.Locked row = conversations.lockState(conversationId).orElse(null);
            if (row == null) {
                return null;
            }
            // 바깥 호출이 도는 사이에 다른 요청이 저장했으면 이번 것은 쓰지 않는다.
            if (row.getStateRevision() != expectedRevision || !"open".equals(row.getStatus())) {
                return null;
            }
            int nextIndex = messages.nextIndex(conversationId);
            insertMessage(conversationId, nextIndex, "actor", actorText, requestId, fingerprint, now);
            insertMessage(conversationId, nextIndex + 1, "ai", coachMessage, null, null, now);
            conversations.saveTurn(conversationId, state == null ? "{}" : text(state), status, closeReason, now);
            if ("closed".equals(status)) {
                stages.conversationClosed(conversationId, now);
            }
            return new Saved(expectedRevision + 1, status, closeReason, (int) messages.coachReplies(conversationId));
        });
    }

    private void insertMessage(
            UUID conversationId, int turnIndex, String role, String text, UUID requestId, String fingerprint,
            Instant now) {
        messages.insert(UUID.randomUUID(), conversationId, turnIndex, role, text == null ? "" : text, requestId, fingerprint,
                now);
    }

    @Override
    public NoteView saveNote(UUID conversationId, NewNote note, Instant now) {
        return transaction.execute(tx -> {
            if (!lockActiveOwner(conversationId)) return null;
            notes.insert(UUID.randomUUID(), conversationId, note.format(), note.kind(), note.title(),
                    text(note.summaryQuotes()), note.nextTake(), text(note.actorWords()), text(note.corrections()),
                    text(note.tags()), note.fallback(), (int) note.sourceRevision(),
                    // 원문이 없으면 SQL NULL 이 아니라 JSON null 을 넣는다(옛 문장과 같다).
                    note.legacyReport() == null ? "null" : text(note.legacyReport()), now);
            return view(notes.ofConversation(conversationId).orElse(null));
        });
    }

    @Override
    public void saveLineNotes(UUID conversationId, JsonNode lineNotes) {
        transaction.execute(tx -> {
            notes.saveLineNotes(conversationId, text(lineNotes));
            return null;
        });
    }

    @Override
    public NoteView replaceNote(UUID conversationId, NewNote note, Instant now) {
        return transaction.execute(tx -> {
            if (!lockActiveOwner(conversationId)) return null;
            notes.upsert(UUID.randomUUID(), conversationId, note.format(), note.kind(), note.title(),
                    text(note.summaryQuotes()), note.nextTake(), text(note.actorWords()), text(note.corrections()),
                    text(note.tags()), note.fallback(), (int) note.sourceRevision(),
                    // 원문이 없으면 SQL NULL 이 아니라 JSON null 을 넣는다(옛 문장과 같다).
                    note.legacyReport() == null ? "null" : text(note.legacyReport()), now);
            return view(notes.ofConversation(conversationId).orElse(null));
        });
    }

    @Override
    public Saved reopen(UUID conversationId, long expectedRevision, JsonNode state, Instant now) {
        return transaction.execute(tx -> {
            if (!lockActiveOwner(conversationId)) return null;
            CoachConversationJpaRepository.Locked row = conversations.lockState(conversationId).orElse(null);
            if (row == null) return null;
            if (row.getStateRevision() != expectedRevision || !"closed".equals(row.getStatus())) {
                return null;
            }
            // 묶음의 첫 행을 잡아 이어하기·재시도와 줄을 세운다. 묶음당 닫히지 않은 회차는 하나다(uq_practices_open_root).
            NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT r.id FROM practices r
                    WHERE r.id=(SELECT p.root_id FROM practices p
                                JOIN coach_conversations c ON c.practice_id=p.id
                                WHERE c.id=:conversationId)
                    FOR UPDATE
                    """, Tuple.class)
                    .setParameter("conversationId", conversationId));
            boolean otherOpen = !NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT o.id
                    FROM coach_conversations c
                    JOIN practices p ON p.id=c.practice_id
                    JOIN practices o ON o.root_id=p.root_id AND o.id<>p.id
                    WHERE c.id=:conversationId
                      AND o.stage<>'closed'
                    """, Tuple.class)
                    .setParameter("conversationId", conversationId)).isEmpty();
            if (otherOpen) {
                throw new PracticeInProgress();
            }
            conversations.reopen(conversationId, state == null ? "{}" : text(state), now);
            stages.conversationReopened(conversationId, now);
            return new Saved(expectedRevision + 1, "open", null, (int) messages.coachReplies(conversationId));
        });
    }

    /**
     * 탈퇴·이관과 같은 사용자 행을 먼저 잠근다. 모델 호출 뒤의 새 주인을 확인하고, 계정 잠금 뒤에도
     * 주인이 같은지 다시 보므로 이관 직전 읽은 게스트의 상태로 회원의 쓰기를 판단하지 않는다.
     * 대화 행 잠금은 항상 이 뒤다. 바깥 모델 호출 중에는 어느 잠금도 잡지 않는다.
     */
    private boolean lockActiveOwner(UUID conversationId) {
        while (true) {
            UUID owner = currentOwner(conversationId);
            if (owner == null) return false;
            boolean active = accountRows.lockActive(owner);
            if (!owner.equals(currentOwner(conversationId))) continue;
            if (!active) {
                throw new OwnerNotActive();
            }
            return true;
        }
    }

    private UUID currentOwner(UUID conversationId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT p.user_id FROM coach_conversations c JOIN practices p ON p.id=c.practice_id
                WHERE c.id=:id
                """, Tuple.class).setParameter("id", conversationId));
        return rows.isEmpty() ? null : rows.getFirst().get("user_id", UUID.class);
    }

    @Override
    public NoteView note(UUID userId, UUID practiceId) {
        List<Tuple> owned = NativeTuples.list(entityManager.createNativeQuery(
                "SELECT id FROM practices WHERE id=:practiceId AND user_id=:userId", Tuple.class)
                .setParameter("practiceId", practiceId)
                .setParameter("userId", userId));
        if (owned.isEmpty()) {
            return null;
        }
        NoteView note = view(notes.ofPractice(practiceId).orElse(null));
        return note == null ? legacyNote(userId, practiceId) : note;
    }

    /**
     * 새 표에 노트가 없는 회차의 옛 노트를 <b>새 봉투에 담아</b> 낸다 (specs/practice 「0.1.0 스키마 전환」). 옛 자료를
     * 옮길 때 노트는 새 표로 간 대화(가장 최근 하나)의 것만 따라갔고, 그보다 앞선 대화의 노트는 옛 표에 남았다.
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
        String mode = LenientJson.asText(report.path("mode"), "record_only");
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
        return value == null || value.isMissingNode() || value.isNull() || LenientJson.asText(value).isBlank()
                ? null
                : LenientJson.asText(value);
    }

    private static NoteView view(CoachNoteJpaRepository.Stored row) {
        if (row == null) {
            return null;
        }
        return new NoteView(
                row.getId(),
                row.getConversationId(),
                row.getFormat(),
                row.getKind(),
                row.getTitle(),
                json(row.getSummaryQuotes()),
                row.getNextTake(),
                json(row.getActorWords()),
                json(row.getCorrections()),
                json(row.getTags()),
                row.getFallback(),
                row.getSourceRevision(),
                json(row.getLegacyReport()),
                row.getCreatedAt(),
                json(row.getLineNotes()));
    }

    @Override
    public ConversationView conversation(UUID userId, UUID conversationId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT c.id,c.practice_id,c.status,c.close_reason,c.state_revision,c.created_at,p.experience_version,
                       %s AS session_purpose,CAST(c.state AS text) AS state
                FROM coach_conversations c
                JOIN practices p ON p.id=c.practice_id
                WHERE c.id=:conversationId
                  AND p.user_id=:userId
                """.formatted(SESSION_PURPOSE), Tuple.class)
                .setParameter("conversationId", conversationId)
                .setParameter("userId", userId));
        if (rows.isEmpty()) {
            return legacyConversation(userId, conversationId);
        }
        Tuple row = rows.getFirst();
        List<Turn> turns = messages.shown(conversationId).stream()
                .map(turn -> new Turn(
                        turn.getTurnIndex(),
                        // 저장은 옛 값과 같은 `ai` 이고 화면에는 `coach` 로 보인다.
                        "ai".equals(turn.getRole()) ? "coach" : turn.getRole(),
                        turn.getText(),
                        turn.getCreatedAt()))
                .toList();
        return new ConversationView(
                row.get("id", UUID.class),
                row.get("practice_id", UUID.class),
                row.get("status", String.class),
                row.get("close_reason", String.class),
                row.get("experience_version", String.class),
                ((Number) row.get("state_revision")).longValue(),
                row.get("created_at", Instant.class),
                turns,
                com.acttub.actingapi.feature.coach.app.PurposeLoop.view(row.get("session_purpose", String.class),
                        json(row.get("state", String.class))),
                com.acttub.actingapi.feature.coach.app.AnswerExamples.from(row.get("session_purpose", String.class),
                        json(row.get("state", String.class))));
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
     * 옛 표에 남은 대화 (specs/practice 「0.1.0 스키마 전환」). <b>한 연습에 대화가 여럿인 옛 자료</b>의 "이전 대화" 가 이
     * 경로로 열린다 — 최근 하나로 자르지 않는다(practice.coach).
     *
     * <p>종료 사유는 옛 어휘를 그대로 낸다. 새 표로 옮긴 대화는 새 어휘를 쓰지만, 여기서 읽는 것은 옛 표에
     * 남은 행이고 그 행의 값을 고쳐 보이지 않는다. 다만 상태는 늘 closed 로 낸다 — 답·이어 하기는 새 표만 보므로
     * 옛 표의 열린 대화에는 이어 말할 수 없다(practice README 「호환 읽기」).
     */
    private ConversationView legacyConversation(UUID userId, UUID conversationId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery("""
                SELECT cs.id,cs.practice_session_id,
                       cs.close_reason::text AS close_reason,cs.state_revision,cs.created_at,ps.experience_version
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
                "closed",
                row.get("close_reason", String.class),
                row.get("experience_version", String.class),
                ((Number) row.get("state_revision")).longValue(),
                row.get("created_at", Instant.class),
                turns);
    }
}
