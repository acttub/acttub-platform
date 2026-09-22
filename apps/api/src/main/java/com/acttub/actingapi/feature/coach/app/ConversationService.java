package com.acttub.actingapi.feature.coach.app;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.acttub.actingapi.feature.coach.app.ConversationRepository.Loaded;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.NewNote;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.NoteView;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.Replay;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.Saved;
import com.acttub.actingapi.feature.coach.domain.CoachBranch;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.web.ApiException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 1.0.0 회차의 코치 대화 (practice.coach, practice.note).
 *
 * <p><b>바꾸는 것은 저장뿐이다.</b> 코치의 행동 규칙(응답 상한 8/10, 첫 응답 경로, 도움 버튼, 상태 json 의 출처
 * 분리, 프로필 조건부 입력)은 {@link CoachEngine}·{@link CoachPrompt} 가 그대로 갖고 있고, 이 서비스는 엔진이 쓰는
 * {@link CoachSessionSnapshot} 을 새 표에서 만들어 건네고 결과를 새 표에 쓴다(ADR-027, CONTRACT §7·§8).
 *
 * <p><b>회차에 대화는 하나다.</b> 열린 대화는 같은 id 로 재개하고 닫힌 뒤 다시 코칭하려면 새 회차다.
 *
 * <p>멱등과 충돌: 시작은 {@code start_request_id}, 배우 메시지는 {@code (conversation_id, request_id)} 로 멱등하다.
 * 같은 id 에 다른 본문이면 422 {@code request_fingerprint_mismatch}, {@code revision} 이 다르면 409
 * {@code conversation_conflict}, 닫힌 대화에 답하면 409 {@code conversation_closed} 다.
 */
public class ConversationService {

    /** 배우 답의 상한(자). */
    public static final int ACTOR_TEXT_MAX_CHARS = 300;

    /** 코치 응답 수의 상한 — 시작 응답을 포함한다(§7-1, §8-5). */
    public static final int LEGACY_REPLY_LIMIT = 8;
    public static final int THREE_LAYERS_REPLY_LIMIT = 10;

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String COMPLETE = "complete";

    private final ConversationRepository conversations;
    private final CoachEngine coach;
    private final NoteWriter notes;
    private final Clock clock;
    private final ConversationClosedListener closedListener;
    private final CoachProfile profiles;
    private final CoachMemory memory;
    private final FailureReporter failureReporter;
    private final Set<RequestKey> generating = ConcurrentHashMap.newKeySet();

    private record RequestKey(String operation, UUID userId, UUID targetId, UUID requestId) { }

    public ConversationService(
            ConversationRepository conversations,
            CoachEngine coach,
            NoteWriter notes,
            Clock clock,
            ConversationClosedListener closedListener,
            CoachProfile profiles,
            CoachMemory memory,
            FailureReporter failureReporter) {
        this.conversations = conversations;
        this.coach = coach;
        this.notes = notes;
        this.clock = clock;
        this.closedListener = closedListener;
        this.profiles = profiles;
        this.memory = memory;
        this.failureReporter = failureReporter;
    }

    /** 분석이 끝난 회차에서 대화를 연다. 이미 열린 대화가 있으면 그것을 재개한다. */
    public Turn start(UUID userId, UUID practiceId, UUID requestId) {
        return withRequestInFlight(new RequestKey("start", userId, practiceId, requestId),
                () -> startTurn(userId, practiceId, requestId));
    }

    private Turn startTurn(UUID userId, UUID practiceId, UUID requestId) {
        Loaded loaded = require(conversations.loadByPractice(userId, practiceId));
        if (loaded.conversationId() != null) {
            if ("closed".equals(loaded.session().status())) {
                // 닫힌 뒤 다시 코칭하려면 새 회차다(practice.resume).
                throw new ApiException(409, "conversation_closed");
            }
            if (!loaded.session().turns().isEmpty()) {
                return turn(loaded.session(), loaded.conversationId(), null);
            }
            // 첫 모델 호출이 실패한 행에는 아직 메시지가 없다. 빈 응답으로 재개하지 않고 다시 생성한다.
        }
        if (!"conversing".equals(loaded.stage())) {
            throw new ApiException(409, "analysis_not_ready");
        }
        UUID conversationId = conversations.open(practiceId, requestId, clock.instant());
        Loaded opened = require(conversations.loadByConversation(userId, conversationId));
        if (!opened.session().turns().isEmpty()) {
            // 같은 요청이 먼저 열고 첫 응답까지 저장했다 — 시작 재전송이 턴을 늘리지 않는다.
            return turn(opened.session(), conversationId, null);
        }
        CoachResult result = generate(() -> coach.start(withContext(opened.session()), conversationId));
        activeOnly(() -> {
            conversations.saveOpening(conversationId, result.reply().message(), result.session().coachingState(), clock.instant());
            return null;
        });
        Loaded saved = require(conversations.loadByConversation(userId, conversationId));
        return turn(saved.session(), conversationId, null);
    }

    /**
     * 대화를 한 턴 잇는다. 바깥 호출(LLM)은 트랜잭션 밖이고, 저장할 때 {@code revision} 이 읽은 값과 다르면
     * 아무것도 쓰지 않는다.
     */
    public Turn reply(UUID userId, UUID conversationId, UUID requestId, String text, Long revision) {
        return withRequestInFlight(new RequestKey("reply", userId, conversationId, requestId),
                () -> replyTurn(userId, conversationId, requestId, text, revision));
    }

    private Turn replyTurn(UUID userId, UUID conversationId, UUID requestId, String text, Long revision) {
        Loaded loaded = require(conversations.loadByConversation(userId, conversationId));
        String fingerprint = fingerprint("coach_reply|" + conversationId + "|" + text);
        Replay replayed = conversations.findReplay(conversationId, requestId, fingerprint);
        if (replayed != null) {
            if (replayed.mismatch()) {
                throw new ApiException(422, "request_fingerprint_mismatch");
            }
            // 그 요청이 만든 코치 응답·종료·노트 결과를 그대로 돌려준다.
            List<ConversationRepository.Turn> originalTurns = turns(loaded.session()).stream()
                    .limit(replayed.turnCount()).toList();
            return new Turn(
                    conversationId,
                    replayed.status(),
                    replayed.closeReason(),
                    replayed.revision(),
                    replayed.coachMessage(),
                    (int) originalTurns.stream().filter(turn -> "coach".equals(turn.role())).count(),
                    replyLimit(loaded.session()),
                    originalTurns,
                    "closed".equals(replayed.status()) ? conversations.note(userId, loaded.practiceId()) : null);
        }
        if ("closed".equals(loaded.session().status())) {
            throw new ApiException(409, "conversation_closed");
        }
        if (revision != null && revision != loaded.session().stateRevision()) {
            throw new ApiException(409, "conversation_conflict");
        }
        CoachResult result = generate(() -> coach.reply(withContext(loaded.session()), text, conversationId));
        boolean closing = COMPLETE.equals(result.reply().status());
        Saved saved = activeOnly(() -> conversations.appendTurn(
                conversationId,
                loaded.session().stateRevision(),
                requestId,
                fingerprint,
                text,
                result.reply().message(),
                result.session().coachingState(),
                closing ? "closed" : "open",
                closing ? closeReason(result) : null,
                clock.instant()));
        if (saved == null) {
            throw new ApiException(409, "conversation_conflict");
        }
        NoteView note = closing
                ? activeOnly(() -> notes.write(loaded, result, saved.revision(), clock.instant()))
                : null;
        if (closing && closedListener != null) {
            // 노트가 남은 뒤에 알린다 — 확인 연습을 세는 쪽이 이번 회차의 노트를 보아야 한다.
            closedListener.onConversationClosed(userId, loaded.practiceId());
        }
        Loaded after = require(conversations.loadByConversation(userId, conversationId));
        return new Turn(
                conversationId,
                saved.status(),
                saved.closeReason(),
                saved.revision(),
                result.reply().message(),
                saved.coachReplyCount(),
                replyLimit(loaded.session()),
                turns(after.session()).stream().limit(result.session().turns().size()).toList(),
                note);
    }

    /** 대화 하나를 턴과 함께. 409 뒤 화면이 최신 상태를 다시 읽는 자리다. */
    public ConversationRepository.ConversationView conversation(UUID userId, UUID conversationId) {
        ConversationRepository.ConversationView view = conversations.conversation(userId, conversationId);
        if (view == null) {
            throw new ApiException(404, "conversation_not_found");
        }
        return view;
    }

    /** 그 회차의 노트. 없으면 404 — 아직 정리가 없는 회차다. */
    public NoteView note(UUID userId, UUID practiceId) {
        NoteView note = conversations.note(userId, practiceId);
        if (note == null) {
            throw new ApiException(404, "note_not_found");
        }
        return note;
    }

    /**
     * 한 턴의 결과.
     *
     * @param coachReplyCount 시작 응답을 포함한 코치 응답 수. 화면이 남은 수와 마무리 예고를 그린다
     */
    public record Turn(
            UUID conversationId,
            String status,
            String closeReason,
            long revision,
            String coachMessage,
            int coachReplyCount,
            int replyLimit,
            List<ConversationRepository.Turn> turns,
            NoteView note) {
    }

    private Turn turn(CoachSessionSnapshot session, UUID conversationId, NoteView note) {
        List<ConversationRepository.Turn> turns = turns(session);
        return new Turn(
                conversationId,
                session.status(),
                session.closeReason(),
                session.stateRevision(),
                turns.isEmpty() ? "" : turns.getLast().text(),
                coachReplies(session),
                replyLimit(session),
                turns,
                note);
    }

    private static List<ConversationRepository.Turn> turns(CoachSessionSnapshot session) {
        List<CoachTurnSnapshot> stored = session.turns();
        return java.util.stream.IntStream.range(0, stored.size())
                .mapToObj(index -> new ConversationRepository.Turn(
                        index,
                        "ai".equals(stored.get(index).role()) ? "coach" : stored.get(index).role(),
                        stored.get(index).text(),
                        null))
                .toList();
    }

    private static int coachReplies(CoachSessionSnapshot session) {
        return (int) session.turns().stream().filter(turn -> "ai".equals(turn.role())).count();
    }

    private static int replyLimit(CoachSessionSnapshot session) {
        return replyLimit(session.experienceVersion());
    }

    public static int replyLimit(String experienceVersion) {
        return "three_layers_v1".equals(experienceVersion) ? THREE_LAYERS_REPLY_LIMIT : LEGACY_REPLY_LIMIT;
    }

    /** 상한에 닿아 끝났는지, 배우가 마쳤는지. 엔진이 사유를 주지 않으면 소진으로 본다. */
    private static String closeReason(CoachResult result) {
        JsonNode handoff = result.reply().handoff();
        String reason = handoff == null ? null : handoff.path("end_reason").asText(null);
        return switch (reason == null ? "" : reason) {
            case "gap_stated", "exhausted", "limit", "user_ended", "system_failure" -> reason;
            default -> "exhausted";
        };
    }

    /**
     * 게이트를 지난 뒤에 다른 기기의 탈퇴가 먼저 끝났으면 저장소가 쓰지 않고 알린다. 게이트가 했을 답을
     * 그대로 준다 — 기기는 그 사유로 옛 계정의 쓰기와 재시도를 멈춘다(account.withdraw).
     */
    private static <T> T activeOnly(java.util.function.Supplier<T> write) {
        try {
            return write.get();
        } catch (ConversationRepository.OwnerNotActive closed) {
            throw new ApiException(403, "account_deactivated", closed);
        }
    }

    private static CoachResult generate(java.util.function.Supplier<CoachResult> request) {
        try {
            return request.get();
        } catch (CoachReplyUnavailable failure) {
            throw ApiException.external(502, "coach_response_unavailable", failure);
        }
    }

    /** 같은 서버의 중복 전송이 모델을 함께 부르지 않게 한다. 저장은 DB의 revision·유일성으로도 보호한다. */
    private Turn withRequestInFlight(RequestKey key, java.util.function.Supplier<Turn> request) {
        if (!generating.add(key)) throw new ApiException(409, "request is still processing");
        try {
            return request.get();
        } finally {
            generating.remove(key);
        }
    }

    private static Loaded require(Loaded loaded) {
        if (loaded == null) {
            throw new ApiException(404, "practice_not_found");
        }
        return loaded;
    }

    /** 모델을 부르는 턴마다 읽는다. 저장소에 프로필을 복제하지 않고, 조회 실패도 대화를 막지 않는다(§7-2). */
    private CoachSessionSnapshot withContext(CoachSessionSnapshot session) {
        try {
            session = session.withPrior(memory.priorForPractice(session.userId(), session.practiceSessionId(), null));
        } catch (RuntimeException failure) {
            failureReporter.report(failure, new FailureContext("ConversationService.priorContext"));
        }
        try {
            return session.withActorProfile(profiles.completeFor(session.userId()));
        } catch (RuntimeException failure) {
            failureReporter.report(failure, new FailureContext("ConversationService.actorProfile"));
            return session;
        }
    }

    static String fingerprint(String payload) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(payload.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    /** 코치 갈래 이름 — 노트의 기존 종류(analysis·expression)가 여기서 나온다. */
    static String branchOf(CoachSessionSnapshot session) {
        return session.threeLayers() ? "coaching" : CoachBranch.of(session.blockageKind());
    }

    static ObjectMapper json() {
        return JSON;
    }
}
