package com.acttub.actingapi.feature.coach.app;

import java.time.Clock;
import java.time.Instant;
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
import com.acttub.actingapi.platform.schema.ExperienceVersion;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.Hashing;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

/**
 * 0.1.0 회차의 코치 대화 (practice.coach, practice.note).
 *
 * <p><b>바꾸는 것은 저장뿐이다.</b> 코치의 행동 규칙(응답 상한 8/16, 첫 응답 경로, 도움 버튼, 상태 json 의 출처
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
    public static final int THREE_LAYERS_REPLY_LIMIT = 24;

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
    /** 회차별로 모델을 부르고 있는 시작(SOMA-780). 앱의 시작 요청과 서버의 첫 질문 미리 쓰기가 같은 첫 질문을 두 번 쓰지 않게 한다. */
    private final java.util.Map<UUID, java.util.concurrent.CompletableFuture<Void>> starting = new ConcurrentHashMap<>();
    /** 다른 시작을 기다리는 최대 시간. 영상 처리 대기(180초)와 첫 질문 쓰기를 넉넉히 덮는다. 넘으면 기다리지 않고 직접 쓴다. */
    private java.time.Duration startWait = java.time.Duration.ofSeconds(200);

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
        return start(userId, practiceId, requestId, null);
    }

    /** 첫 응답을 쓰는 대로 {@code stream} 에 흘려보낸다(코칭 스트리밍). 저장·재전송 규칙은 {@link #start(UUID, UUID, UUID)} 와 같다. */
    public Turn start(UUID userId, UUID practiceId, UUID requestId, CoachStream stream) {
        return withRequestInFlight(new RequestKey("start", userId, practiceId, requestId),
                () -> oneStartPerPractice(practiceId, stream, () -> startTurn(userId, practiceId, requestId, stream)));
    }

    /**
     * 분석이 끝난 회차의 첫 질문을 앱이 청하기 전에 미리 쓴다(SOMA-780). 앱은 연습을 만든 뒤 약 5초 만에 시작을 청하는데,
     * 영상은 올리기 끝에서 이미 준비돼 있어 그동안 모델이 놀고 있었다. 앱의 시작과 같은 경로로 대화를 열고 첫 질문을 저장해
     * 두면, 앱의 시작 요청은 저장된 첫 질문을 바로 받는다(아직 쓰는 중이면 끝나길 기다린다). 이미 대화가 있거나 분석이 안
     * 끝났으면 하지 않는다. 실패해도 앱의 시작 요청이 직접 쓴다 — 미리 쓰기는 덤이다.
     */
    public void prewriteStart(UUID userId, UUID practiceId) {
        if (userId == null || practiceId == null) return;
        try {
            Loaded loaded = conversations.loadByPractice(userId, practiceId);
            if (loaded == null || loaded.conversationId() != null || !"conversing".equals(loaded.stage())) return;
            start(userId, practiceId, prewriteRequest(practiceId), null);
        } catch (ApiException expected) {
            // 이미 다른 시작이 쓰는 중이거나 첫 질문을 쓰지 못했다(코치 쪽이 이미 기록했다) — 앱의 시작 요청에 맡긴다.
        } catch (RuntimeException failure) {
            failureReporter.report(failure, new FailureContext("ConversationService.prewriteStart"));
        }
    }

    /** 미리 쓰기의 시작 요청 번호. 같은 회차면 늘 같다 — 다시 불려도 대화를 두 번 열지 않는다. */
    static UUID prewriteRequest(UUID practiceId) {
        return UUID.nameUUIDFromBytes(("coach-prewrite:" + practiceId).getBytes(java.nio.charset.StandardCharsets.UTF_8));
    }

    /**
     * 같은 회차의 시작은 한 번에 하나만 모델을 부른다(SOMA-780). 앞선 시작(보통 서버의 미리 쓰기)이 쓰는 중이면 끝나길
     * 기다렸다가 진행한다 — 그러면 {@link #startTurn} 이 저장된 첫 질문을 그대로 돌려준다. 스트리밍이면 기다리는 동안
     * 연결이 끊기지 않게 먼저 연다(핑이 돈다).
     */
    private Turn oneStartPerPractice(UUID practiceId, CoachStream stream, java.util.function.Supplier<Turn> work) {
        var mine = new java.util.concurrent.CompletableFuture<Void>();
        java.util.concurrent.CompletableFuture<Void> other;
        while ((other = starting.putIfAbsent(practiceId, mine)) != null) {
            if (stream != null) stream.begin();
            if (!awaitStart(other)) break;
        }
        try {
            return work.get();
        } finally {
            starting.remove(practiceId, mine);
            mine.complete(null);
        }
    }

    /** 앞선 시작을 기다린다. 너무 오래 걸리면 기다리지 않고 직접 쓴다(false). */
    private boolean awaitStart(java.util.concurrent.CompletableFuture<Void> other) {
        try {
            other.get(startWait.toMillis(), java.util.concurrent.TimeUnit.MILLISECONDS);
            return true;
        } catch (java.util.concurrent.TimeoutException late) {
            return false;
        } catch (java.util.concurrent.ExecutionException finished) {
            return true;
        } catch (InterruptedException interrupted) {
            Thread.currentThread().interrupt();
            return false;
        }
    }

    /** Test-only: 다른 시작을 기다리는 시간을 줄여 본다. */
    ConversationService withStartWait(java.time.Duration wait) {
        this.startWait = wait;
        return this;
    }

    private Turn startTurn(UUID userId, UUID practiceId, UUID requestId, CoachStream stream) {
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
        if (stream != null) stream.begin();
        CoachResult result = generate(() -> stream == null ? coach.start(withContext(opened.session()), conversationId)
                : coach.start(withContext(opened.session()), conversationId, stream));
        boolean closing = COMPLETE.equals(result.reply().status());
        boolean rejected = DirectVideoPracticeLoop.wasCut(result.session().coachingState());
        activeOnly(() -> {
            conversations.saveOpening(conversationId, result.reply().message(), result.session().coachingState(),
                    closing ? closeReason(result) : null, clock.instant());
            return null;
        });
        Loaded saved = require(conversations.loadByConversation(userId, conversationId));
        NoteView note = closing && !rejected
                ? activeOnly(() -> notes.write(opened, result, saved.session().stateRevision(), clock.instant())) : null;
        if (closing && !rejected && closedListener != null) closedListener.onConversationClosed(userId, practiceId);
        return turn(saved.session(), conversationId, note);
    }

    /**
     * 대화를 한 턴 잇는다. 바깥 호출(LLM)은 트랜잭션 밖이고, 저장할 때 {@code revision} 이 읽은 값과 다르면
     * 아무것도 쓰지 않는다.
     */
    public Turn reply(UUID userId, UUID conversationId, UUID requestId, String text, Long revision) {
        return reply(userId, conversationId, requestId, text, revision, null);
    }

    /** 코치 답을 쓰는 대로 {@code stream} 에 흘려보낸다(코칭 스트리밍). 저장·재전송·충돌 규칙은 그대로다. */
    public Turn reply(UUID userId, UUID conversationId, UUID requestId, String text, Long revision, CoachStream stream) {
        return withRequestInFlight(new RequestKey("reply", userId, conversationId, requestId),
                () -> replyTurn(userId, conversationId, requestId, text, revision, stream));
    }

    private Turn replyTurn(UUID userId, UUID conversationId, UUID requestId, String text, Long revision, CoachStream stream) {
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
                    "closed".equals(replayed.status()) ? conversations.note(userId, loaded.practiceId()) : null,
                    PurposeView.from(loaded.session().sessionPurpose(), loaded.session().coachingState()),
                    AnswerExamples.from(loaded.session().sessionPurpose(), loaded.session().coachingState()));
        }
        if ("closed".equals(loaded.session().status())) {
            throw new ApiException(409, "conversation_closed");
        }
        if (revision != null && revision != loaded.session().stateRevision()) {
            throw new ApiException(409, "conversation_conflict");
        }
        if (stream != null) stream.begin();
        CoachResult result = generate(() -> stream == null ? coach.reply(withContext(loaded.session()), text, conversationId)
                : coach.reply(withContext(loaded.session()), text, conversationId, stream));
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
        // 이어 가던 대화가 다시 정리되면 있던 노트를 고친다. 새로 만들지 못하면 있던 노트를 그대로 보여 준다.
        boolean resumed = isResumed(loaded.session().coachingState());
        NoteView note = closing
                ? activeOnly(() -> resumed ? notes.write(loaded, result, saved.revision(), clock.instant(), true)
                        : notes.write(loaded, result, saved.revision(), clock.instant()))
                : null;
        if (closing && resumed && note == null) note = conversations.note(userId, loaded.practiceId());
        if (closing && !resumed && closedListener != null) {
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
                displayLimit(result.session(), saved.coachReplyCount()),
                turns(after.session()).stream().limit(result.session().turns().size()).toList(),
                note,
                PurposeView.from(result.session().sessionPurpose(), result.session().coachingState()),
                AnswerExamples.from(result.session().sessionPurpose(), result.session().coachingState()));
    }

    /**
     * 닫힌 대화를 같은 대화로 다시 연다(SOMA-782 「더 얘기하기」). 새 회차·새 대화를 만들지 않으므로 무료 횟수와 통계에
     * 새 코칭으로 잡히지 않는다. 이미 열려 있으면 그대로 돌려준다(재전송). 코치 응답 상한에 가까우면 409
     * {@code conversation_limit_reached}, 신형이 아니거나 연기 영상이 아니어서 끊긴 대화면 409
     * {@code conversation_not_resumable} 이다. 코치 프롬프트는 건드리지 않는다 — 다음 배우 말부터 평소 규칙으로 이어진다.
     */
    public Turn resume(UUID userId, UUID conversationId, Long revision) {
        Loaded loaded = require(conversations.loadByConversation(userId, conversationId));
        CoachSessionSnapshot session = loaded.session();
        if (!"closed".equals(session.status())) {
            return turn(session, conversationId, conversations.note(userId, loaded.practiceId()));
        }
        if (revision != null && revision != session.stateRevision()) {
            throw new ApiException(409, "conversation_conflict");
        }
        if (!session.threeLayers() || DirectVideoPracticeLoop.wasCut(session.coachingState())) {
            throw new ApiException(409, "conversation_not_resumable");
        }
        int replies = coachReplies(session);
        if (replies >= THREE_LAYERS_REPLY_LIMIT - 2) {
            throw new ApiException(409, "conversation_limit_reached");
        }
        ObjectNode state = session.coachingState() instanceof ObjectNode object
                ? object.deepCopy() : CoachingStateReducer.empty();
        state.put("revision", session.stateRevision() + 1);
        // 두 갈래(연습 루프·목적별 코칭)가 각자 상태 칸을 읽으므로 있는 칸마다 표시한다.
        boolean marked = false;
        for (String key : List.of(DirectVideoPracticeLoop.STATE_KEY, PurposeLoop.STATE_KEY)) {
            if (state.get(key) instanceof ObjectNode loop) {
                loop.put(PracticeLoopRouter.RESUMED_AT, replies);
                marked = true;
            }
        }
        if (!marked) state.putObject(DirectVideoPracticeLoop.STATE_KEY).put(PracticeLoopRouter.RESUMED_AT, replies);
        Saved reopened = activeOnly(() -> conversations.reopen(conversationId, session.stateRevision(), state, clock.instant()));
        if (reopened == null) {
            throw new ApiException(409, "conversation_conflict");
        }
        Loaded after = require(conversations.loadByConversation(userId, conversationId));
        return turn(after.session(), conversationId, conversations.note(userId, loaded.practiceId()));
    }

    /** 한 번이라도 다시 열었던 대화인가. */
    private static boolean isResumed(JsonNode state) {
        return PurposeLoop.resumedAt(PurposeLoop.loop(state)) >= 0
                || PurposeLoop.resumedAt(state == null ? null : state.path(DirectVideoPracticeLoop.STATE_KEY)) >= 0;
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
            NoteView note,
            // 목적별 코칭(SOMA-719)의 버튼·장면·카드. 목적 없이 시작한 대화는 null.
            PurposeView purpose,
            // 목적 없는 질문 대화의 지금 질문 예시 답 1~2개. 없으면 빈 목록이다.
            List<String> answerExamples) {

        public Turn {
            answerExamples = answerExamples == null ? List.of() : List.copyOf(answerExamples);
        }

        public Turn(UUID conversationId, String status, String closeReason, long revision, String coachMessage,
                int coachReplyCount, int replyLimit, List<ConversationRepository.Turn> turns, NoteView note, PurposeView purpose) {
            this(conversationId, status, closeReason, revision, coachMessage, coachReplyCount, replyLimit, turns, note, purpose, List.of());
        }

        public Turn(UUID conversationId, String status, String closeReason, long revision, String coachMessage,
                int coachReplyCount, int replyLimit, List<ConversationRepository.Turn> turns, NoteView note) {
            this(conversationId, status, closeReason, revision, coachMessage, coachReplyCount, replyLimit, turns, note, null, List.of());
        }
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
                displayLimit(session, coachReplies(session)),
                turns,
                note,
                PurposeView.from(session.sessionPurpose(), session.coachingState()),
                AnswerExamples.from(session.sessionPurpose(), session.coachingState()));
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

    /**
     * 화면에 보낼 응답 상한. 코치가 정리했거나 정리 뒤 마지막 답을 했으면 다음 배우 말에서 닫히므로
     * "코치 응답 수 + 1"로 내려 앱이 "다음 답으로 마무리해요"를 띄우게 한다. 서버가 닫는 판단에는 쓰지 않는다.
     */
    static int displayLimit(CoachSessionSnapshot session, int coachReplies) {
        int limit = replyLimit(session);
        // 목적별 코칭은 상한을 채우는 응답이 정리이고 그 응답에서 닫힌다.
        if (PurposeLoop.of(session) != null) {
            int resumed = session == null ? -1 : PurposeLoop.resumedAt(PurposeLoop.loop(session.coachingState()));
            return Math.min(limit, PurposeLoop.REPLY_CAP + Math.max(0, resumed));
        }
        if (session == null || !"open".equals(session.status()) || session.coachingState() == null) return limit;
        var statuses = session.coachingState().path(DirectVideoPracticeLoop.STATE_KEY).path("statuses");
        if (!statuses.isArray() || statuses.isEmpty()) return limit;
        String last = statuses.get(statuses.size() - 1).asText("");
        boolean closesNext = DirectVideoPracticeLoop.action(last).startsWith(PracticeLoopRouter.WRAP_UP)
                || DirectVideoPracticeLoop.statusField(last, "다음에 닫기").startsWith("예");
        return closesNext ? Math.min(limit, coachReplies + 1) : limit;
    }

    private static int replyLimit(CoachSessionSnapshot session) {
        return replyLimit(session.experienceVersion());
    }

    public static int replyLimit(String experienceVersion) {
        return ExperienceVersion.THREE_LAYERS_V1.dbValue().equals(experienceVersion)
                ? THREE_LAYERS_REPLY_LIMIT : LEGACY_REPLY_LIMIT;
    }

    /** 상한에 닿아 끝났는지, 배우가 마쳤는지. 엔진이 사유를 주지 않으면 소진으로 본다. */
    private static String closeReason(CoachResult result) {
        JsonNode handoff = result.reply().handoff();
        String reason = handoff == null ? null : handoff.path("end_reason").asText(null);
        if (reason == null || reason.isBlank()) reason = result.session().closeReason();
        return switch (reason == null ? "" : reason) {
            case "actor_finished" -> "user_ended";
            case "turn_budget" -> "limit";
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
        return Hashing.sha256Hex(payload);
    }

    /** 코치 갈래 이름 — 노트의 기존 종류(analysis·expression)가 여기서 나온다. */
    static String branchOf(CoachSessionSnapshot session) {
        return session.threeLayers() ? "coaching" : CoachBranch.of(session.blockageKind());
    }

    static ObjectMapper json() {
        return JSON;
    }
}
