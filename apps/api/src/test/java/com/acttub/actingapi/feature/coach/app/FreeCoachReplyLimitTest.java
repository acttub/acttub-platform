package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.ConversationRepository.Loaded;
import com.acttub.actingapi.feature.coach.app.ConversationRepository.Saved;
import com.acttub.actingapi.feature.coach.app.PracticeLoopRouter.Before;
import com.acttub.actingapi.feature.coach.app.PracticeLoopRouter.Kind;
import com.acttub.actingapi.feature.coach.app.PracticeLoopRouter.Tally;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 무료 코칭은 배우 답 7번까지(SOMA-1131). 배우 답 7번 = 코치 응답 8번째(시작 응답 포함)에서 닫힌다. 6번째 답부터 정리하고,
 * 7번째 답에 대한 코치 말이 마지막이며 서버가 고정 한 줄을 붙인다. Pro·유예·한도 꺼짐은 지금 그대로(24·9)다.
 */
class FreeCoachReplyLimitTest {
    /** 기본 설정(COACHING_FREE_REPLY_LIMIT=7)의 무료 회원. */
    static final CoachFreeReplies FREE = userId -> 7;
    /** 무료 회원의 코치 응답 상한(시작 포함). */
    static final int FREE_CAP = 8;

    // ---- 경계값 ----

    @Test
    @DisplayName("배우 답 7번이면 코치 응답 상한은 시작을 포함해 8이고, 0 이하·판정 실패는 상한이 없다")
    void sevenActorAnswersMeanEightCoachReplies() {
        UUID user = UUID.randomUUID();
        assertThat(CoachFreeReplies.coachReplyCap(FREE, user)).isEqualTo(FREE_CAP);
        assertThat(CoachFreeReplies.coachReplyCap(userId -> 0, user)).as("env 0 이면 끈다").isZero();
        assertThat(CoachFreeReplies.coachReplyCap(userId -> -1, user)).isZero();
        assertThat(CoachFreeReplies.coachReplyCap(CoachFreeReplies.NONE, user)).isZero();
        assertThat(CoachFreeReplies.coachReplyCap(userId -> { throw new IllegalStateException("billing down"); }, user))
                .as("판정이 깨지면 상한을 걸지 않는다").isZero();
        assertThat(CoachFreeReplies.within(ConversationService.THREE_LAYERS_REPLY_LIMIT, FREE_CAP)).isEqualTo(FREE_CAP);
        assertThat(CoachFreeReplies.within(ConversationService.THREE_LAYERS_REPLY_LIMIT, 0)).isEqualTo(24);
        assertThat(CoachFreeReplies.within(ConversationService.THREE_LAYERS_REPLY_LIMIT, 40)).as("기본 상한보다 크면 기본 상한").isEqualTo(24);
    }

    // ---- 연습 루프(PracticeLoopRouter) ----

    static Before free(int reply, String lastDoing, int stage) {
        return new Before(reply, lastDoing, Kind.ANSWER, new Tally(0, 0, 0), List.of(), false, false, false, false, stage, FREE_CAP);
    }

    static Before pro(int reply, String lastDoing, int stage) {
        return new Before(reply, lastDoing, Kind.ANSWER, new Tally(0, 0, 0), List.of(), false, false, false, false, stage);
    }

    @Test
    @DisplayName("무료 6번째 답(코치 응답 7번째)부터는 물음이 와도 새 질문 없이 정리한다")
    void theSixthFreeAnswerWrapsUp() throws Exception {
        var loop = StructuredJson.MAPPER.readTree("{\"statuses\":[\"\"]}");
        Before sixth = PracticeLoopRouter.before(loop, 6, FREE_CAP);
        assertThat(sixth.reply()).as("배우 6번째 답에 대한 응답은 코치 응답 7번째").isEqualTo(7);
        assertThat(sixth.freeCapped()).isTrue();
        assertThat(PracticeLoopRouter.before(loop, 6).freeCapped()).as("기본은 상한 24").isFalse();
        assertThat(PracticeLoopRouterTest.route(Kind.ANSWER, free(7, PracticeLoopRouter.GAP, 3))).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouterTest.route(Kind.QUESTION, free(7, PracticeLoopRouter.GAP, 3))).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouterTest.route(Kind.ANSWER, free(6, PracticeLoopRouter.GAP, 3)))
                .as("5번째 답까지는 평소 단계대로").isEqualTo(PracticeLoopRouter.FIND);
        assertThat(PracticeLoopRouterTest.route(Kind.ANSWER, pro(7, PracticeLoopRouter.GAP, 3)))
                .as("Pro 는 같은 자리에서 정리하지 않는다").isEqualTo(PracticeLoopRouter.FIND);
    }

    @Test
    @DisplayName("아직 정리하지 않은 무료 7번째 답(코치 응답 8번째)은 코치 AI 없이 닫지 않고 정리하며 닫는다 — 그만은 그대로 닫는다")
    void theSeventhFreeAnswerIsTheModelsClosingWrapUp() {
        Before seventh = free(FREE_CAP, PracticeLoopRouter.FIND, 4);
        assertThat(seventh.wrapped()).isFalse();
        assertThat(PracticeLoopRouterTest.route(Kind.ANSWER, seventh)).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouterTest.route(Kind.SHORT, seventh)).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouterTest.route(Kind.QUESTION, seventh)).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouterTest.route(Kind.STOP, seventh)).isEqualTo(PracticeLoopRouter.END);
        assertThat(PracticeLoopRouter.closesNext(PracticeLoopRouterTest.code(Kind.QUESTION), seventh))
                .as("상한 응답 뒤에 받아 줄 차례는 없다").isFalse();
        assertThat(PracticeLoopRouter.routeAlready(PracticeLoopRouterTest.code(Kind.ANSWER), seventh, PracticeLoopRouter.WRAP_UP, false, false))
                .isEqualTo(PracticeLoopRouter.WRAP_UP);
        Before proAtLimit = pro(PracticeLoopRouter.LAST_REPLY, PracticeLoopRouter.WRAP_UP, 4);
        assertThat(PracticeLoopRouterTest.route(Kind.ANSWER, proAtLimit)).as("Pro 상한(24)은 지금처럼 코치 AI 없이 닫는다")
                .isEqualTo(PracticeLoopRouter.END);
        assertThat(PracticeLoopRouter.routeAlready(PracticeLoopRouterTest.code(Kind.ANSWER), proAtLimit, "답하기", false, false))
                .isEqualTo(PracticeLoopRouter.END);
    }

    /** 코치 응답 7번(시작 포함)의 상태 칸. 마지막 둘은 {@code sixth}·{@code seventh}(빈 문자열이면 그 칸 없음). */
    static JsonNode sevenStatuses(String sixth, String seventh) throws Exception {
        var loop = StructuredJson.MAPPER.createObjectNode();
        var statuses = loop.putArray("statuses");
        statuses.add("");
        for (String doing : List.of(PracticeLoopRouter.WANT, PracticeLoopRouter.GAP, PracticeLoopRouter.FIND, PracticeLoopRouter.PROPOSE)) {
            statuses.add("할 일: " + doing);
        }
        statuses.add(sixth);
        statuses.add(seventh);
        return loop;
    }

    @Test
    @DisplayName("정리 → 답하기 → 무료 상한(11/24 dev 재현): 마지막 응답은 정리를 되풀이하지 않고 마지막 한마디로 받아 준다")
    void afterAWrapUpAndAnAnswerTheFreeLastReplyDoesNotWrapAgain() throws Exception {
        JsonNode loop = sevenStatuses("할 일: 정리하기\n단계: 4", "할 일: 답하기\n다음에 닫기: 예");
        Before last = PracticeLoopRouter.before(loop, 7, FREE_CAP);
        assertThat(last.reply()).isEqualTo(FREE_CAP);
        assertThat(last.lastDoing()).isEqualTo("답하기");
        assertThat(last.wrapped()).as("정리 뒤 답하기가 끼어 있어도 이력에서 정리를 본다").isTrue();
        assertThat(last.freeLast()).isTrue();
        for (Kind kind : List.of(Kind.ANSWER, Kind.SHORT, Kind.QUESTION, Kind.METHOD)) {
            assertThat(PracticeLoopRouterTest.route(kind, last)).as(kind.name()).isEqualTo("답하기");
            assertThat(PracticeLoopRouter.closesNext(PracticeLoopRouterTest.code(kind), last))
                    .as("마지막 한마디 지시(lastWordLine)가 붙는다: " + kind.name()).isTrue();
        }
        assertThat(PracticeLoopRouterTest.route(Kind.EVALUATION, last)).isEqualTo("짚어주기");
        assertThat(PracticeLoopRouterTest.route(Kind.CORRECTION, last)).as("마지막 말이라 배우 해석을 되묻지 않는다").isEqualTo("답하기");
        assertThat(PracticeLoopRouterTest.route(Kind.STOP, last)).isEqualTo(PracticeLoopRouter.END);
        assertThat(PracticeLoopRouter.closesNext(PracticeLoopRouterTest.code(Kind.STOP), last)).isFalse();
        assertThat(PracticeLoopRouter.routeAlready(PracticeLoopRouterTest.code(Kind.ANSWER), last, "답하기", false, false))
                .isEqualTo("답하기");
    }

    @Test
    @DisplayName("직전에 정리했거나, 정리 뒤 다음에 닫기 표시 없이 답했어도 무료 마지막 응답은 정리하지 않는다")
    void anyEarlierWrapUpKeepsTheFreeLastReplyFromWrappingAgain() throws Exception {
        Before justWrapped = PracticeLoopRouter.before(sevenStatuses("할 일: 답하기", "할 일: 정리하기\n단계: 4"), 7, FREE_CAP);
        assertThat(PracticeLoopRouterTest.route(Kind.ANSWER, justWrapped)).isEqualTo("답하기");
        assertThat(PracticeLoopRouter.closesNext(PracticeLoopRouterTest.code(Kind.ANSWER), justWrapped)).isTrue();
        Before answeredAfter = PracticeLoopRouter.before(sevenStatuses("할 일: 정리하기\n단계: 4", "할 일: 답하기"), 7, FREE_CAP);
        assertThat(answeredAfter.lastDoing()).isEqualTo("답하기");
        assertThat(answeredAfter.closeNext()).isFalse();
        assertThat(answeredAfter.wrapped()).as("lastDoing·다음에 닫기만으로는 모른다 — 이력에서 본다").isTrue();
        assertThat(PracticeLoopRouterTest.route(Kind.ANSWER, answeredAfter)).isEqualTo("답하기");
        assertThat(PracticeLoopRouter.closesNext(PracticeLoopRouterTest.code(Kind.ANSWER), answeredAfter)).isTrue();
    }

    @Test
    @DisplayName("정리를 아직 안 한 채 무료 상한에 닿으면 정리(WRAP_UP)로 한 번 닫는다")
    void withoutAnEarlierWrapUpTheFreeLastReplyWrapsUpOnce() throws Exception {
        Before last = PracticeLoopRouter.before(sevenStatuses("할 일: " + PracticeLoopRouter.FIND, "할 일: 답하기"), 7, FREE_CAP);
        assertThat(last.wrapped()).isFalse();
        assertThat(PracticeLoopRouterTest.route(Kind.ANSWER, last)).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouterTest.route(Kind.QUESTION, last)).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouter.closesNext(PracticeLoopRouterTest.code(Kind.QUESTION), last))
                .as("정리 지시만 붙고 마지막 한마디 지시는 붙지 않는다").isFalse();
    }

    @Test
    @DisplayName("Pro(상한 24)는 같은 정리 이력이어도 지금 그대로다 — 8번째는 평소 표, 24번째는 코치 AI 없이 닫는다")
    void proKeepsTheSameRoutesWithTheSameWrapHistory() throws Exception {
        JsonNode loop = sevenStatuses("할 일: 정리하기\n단계: 4", "할 일: 답하기\n다음에 닫기: 예");
        Before eighth = PracticeLoopRouter.before(loop, 7);
        assertThat(eighth.freeCapped()).isFalse();
        assertThat(eighth.freeLast()).isFalse();
        assertThat(PracticeLoopRouterTest.route(Kind.ANSWER, eighth)).as("정리 뒤 받아 준 다음 묻지 않은 말은 닫는다").isEqualTo(PracticeLoopRouter.END);
        assertThat(PracticeLoopRouterTest.route(Kind.QUESTION, eighth)).isEqualTo("답하기");
        assertThat(PracticeLoopRouter.closesNext(PracticeLoopRouterTest.code(Kind.QUESTION), eighth)).isTrue();
        Before atLimit = PracticeLoopRouter.before(loop, PracticeLoopRouter.LAST_REPLY - 1);
        assertThat(atLimit.reply()).isEqualTo(PracticeLoopRouter.LAST_REPLY);
        assertThat(PracticeLoopRouterTest.route(Kind.QUESTION, atLimit)).isEqualTo(PracticeLoopRouter.END);
        assertThat(PracticeLoopRouter.closesNext(PracticeLoopRouterTest.code(Kind.QUESTION), atLimit)).isFalse();
    }

    @Test
    @DisplayName("무료 마지막 응답의 인정 말은 앞선 코치 말에서 이미 썼을 때만 뗀다")
    void theFreeLastReplyDropsAnAgreementOnlyWhenItWasAlreadyUsed() {
        String reply = "맞아요, 그거예요.\n\"오라이\"를 짧게 끊고 한 템포 쉬어 보세요.";
        assertThat(DirectVideoPracticeLoop.withoutRepeatedAgreement(reply, List.of("첫 질문", "맞아요, 그거예요.\n쉬는 곳을 만들어 봐도 좋아요.")))
                .isEqualTo("\"오라이\"를 짧게 끊고 한 템포 쉬어 보세요.");
        assertThat(DirectVideoPracticeLoop.withoutRepeatedAgreement(reply, List.of("첫 질문", "쉬는 곳을 만들어 봐도 좋아요.")))
                .as("앞에 없던 인정 말이면 그대로").isEqualTo(reply);
        assertThat(DirectVideoPracticeLoop.withoutRepeatedAgreement("다음 테이크에서 확인해 봐요.", List.of("맞아요, 그거예요.")))
                .isEqualTo("다음 테이크에서 확인해 봐요.");
    }

    // ---- 목적별 코칭(PurposeLoop) ----

    static ObjectNode purposeState(String json) {
        return PurposeLoopTest.state(json);
    }

    @Test
    @DisplayName("목적별 코칭은 무료 7번째 답(코치 응답 8번째)에서 정리하고, Pro 는 9번째 그대로다")
    void purposeLoopWrapsAtTheSeventhFreeAnswer() {
        var reason = purposeState("{\"step\":0}");
        var plain = PurposeLoop.decide(PurposeLoop.Purpose.STUCK, reason, "감정이 안 따라와요", null, PurposeLoopTest.ANSWERED, 7);
        assertThat(plain.wrap()).as("기본 상한(9) 전에는 정리하지 않는다").isFalse();
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.STUCK, reason, "감정이 안 따라와요", null, PurposeLoopTest.ANSWERED, 7, FREE_CAP).wrap())
                .isTrue();
        var sixth = PurposeLoop.decide(PurposeLoop.Purpose.STUCK, reason, "감정이 안 따라와요", null, PurposeLoopTest.ANSWERED, 6, FREE_CAP);
        var sixthPlain = PurposeLoop.decide(PurposeLoop.Purpose.STUCK, reason, "감정이 안 따라와요", null, PurposeLoopTest.ANSWERED, 6);
        assertThat(sixth.wrap()).isEqualTo(sixthPlain.wrap());
        assertThat(sixth.doing()).as("상한 전에는 무료도 같은 단계").isEqualTo(sixthPlain.doing());
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.STUCK, reason, "그만", null, PurposeLoopTest.kind(Kind.STOP), 7, FREE_CAP).end())
                .as("그만은 정리가 아니라 바로 끝").isTrue();
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.STUCK, reason, "감정이 안 따라와요", null, PurposeLoopTest.ANSWERED, 7, 0).wrap())
                .as("상한 꺼짐은 지금 그대로").isFalse();
    }

    @Test
    @DisplayName("다시 연 목적별 대화도 무료 상한은 처음부터 센다")
    void aResumedPurposeConversationStillCountsTheFreeLimitFromTheStart() {
        var resumed = purposeState("{\"step\":0,\"resumed_at\":5}");
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.STUCK, resumed, "감정이 안 따라와요", null, PurposeLoopTest.ANSWERED, 7).wrap())
                .isFalse();
        assertThat(PurposeLoop.decide(PurposeLoop.Purpose.STUCK, resumed, "감정이 안 따라와요", null, PurposeLoopTest.ANSWERED, 7, FREE_CAP).wrap())
                .isTrue();
    }

    // ---- 대화 서비스(응답 상한 표시·고정 한 줄·이어하기) ----

    final ConversationRepository conversations = mock(ConversationRepository.class);
    final CoachEngine coach = mock(CoachEngine.class);
    final NoteWriter notes = mock(NoteWriter.class);
    final ConversationClosedListener listener = mock(ConversationClosedListener.class);
    final MutableClock clock = new MutableClock(Instant.parse("2026-12-02T00:00:00Z"));
    final UUID user = UUID.randomUUID();
    final UUID practice = UUID.randomUUID();
    final UUID conversation = UUID.randomUUID();

    ConversationService service(CoachFreeReplies free) {
        return new ConversationService(conversations, coach, notes, clock, listener, mock(CoachProfile.class),
                mock(CoachMemory.class), new RecordingFailureReporter(), null).withFreeReplies(free);
    }

    /** 코치 응답 {@code coachReplies}번(시작 포함)과 그 사이 배우 답이 있는 대화. */
    CoachSessionSnapshot session(String status, String closeReason, String version, String purpose, JsonNode state, int coachReplies) {
        var turns = new ArrayList<CoachTurnSnapshot>();
        for (int i = 0; i < coachReplies; i++) {
            if (i > 0) turns.add(new CoachTurnSnapshot("actor", "배우 답 " + i));
            turns.add(new CoachTurnSnapshot("ai", "코치 " + i));
        }
        return new CoachSessionSnapshot(UUID.randomUUID(), practice, user, null, "", "", "", 8000, "그 외", "그 외", "",
                status, closeReason, turns, PriorContext.EMPTY, version, 2, state, null, purpose);
    }

    CoachSessionSnapshot loop(String status, String closeReason, int coachReplies) {
        ObjectNode state = StructuredJson.MAPPER.createObjectNode().put("revision", 2);
        state.putObject(DirectVideoPracticeLoop.STATE_KEY).putArray("statuses").add("비추기");
        return session(status, closeReason, "three_layers_v1", null, state, coachReplies);
    }

    void stored(CoachSessionSnapshot session) {
        when(conversations.loadByConversation(user, conversation)).thenReturn(new Loaded(practice, conversation, session.status(), session));
    }

    @Test
    @DisplayName("앱이 받는 응답 상한은 무료면 8 — 7번째 코치 응답 뒤 「다음 답으로 마무리」가 뜬다")
    void theDisplayedLimitIsTheFreeCap() {
        CoachSessionSnapshot open = loop("open", "", 7);
        assertThat(ConversationService.displayLimit(open, 7, FREE_CAP)).isEqualTo(FREE_CAP);
        assertThat(FREE_CAP - 7).as("앱의 nextReplyWraps: 남은 응답 1 이하").isLessThanOrEqualTo(1);
        assertThat(ConversationService.displayLimit(open, 6, FREE_CAP) - 6).as("6번째 응답 뒤에는 아직 예고하지 않는다").isEqualTo(2);
        assertThat(ConversationService.displayLimit(open, 7, 0)).as("Pro·유예·꺼짐은 24").isEqualTo(24);
        assertThat(ConversationService.displayLimit(open, 7)).isEqualTo(24);
        ObjectNode closingState = StructuredJson.MAPPER.createObjectNode();
        closingState.putObject(DirectVideoPracticeLoop.STATE_KEY).putArray("statuses").add("다음에 닫기: 예");
        assertThat(ConversationService.displayLimit(session("open", "", "three_layers_v1", null, closingState, 3), 3, FREE_CAP))
                .as("정리 뒤 예고는 그대로").isEqualTo(4);
        CoachSessionSnapshot purpose = session("open", "", "three_layers_v1", "stuck", null, 3);
        assertThat(ConversationService.displayLimit(purpose, 3, FREE_CAP)).isEqualTo(FREE_CAP);
        assertThat(ConversationService.displayLimit(purpose, 3, 0)).as("목적별 Pro 는 9").isEqualTo(PurposeLoop.REPLY_CAP);
    }

    @Test
    @DisplayName("대화를 다시 읽을 때(GET)의 상한도 무료면 8, Pro 는 24, 옛 갈래는 8 그대로")
    void theConversationReadLimitFollowsThePlan() {
        assertThat(service(FREE).replyLimit(user, "three_layers_v1")).isEqualTo(FREE_CAP);
        assertThat(service(CoachFreeReplies.NONE).replyLimit(user, "three_layers_v1")).isEqualTo(24);
        assertThat(service(userId -> 0).replyLimit(user, "three_layers_v1")).isEqualTo(24);
        assertThat(service(FREE).replyLimit(user, "legacy")).isEqualTo(ConversationService.LEGACY_REPLY_LIMIT);
    }

    CoachResult closingResult(CoachSessionSnapshot session, String message, String endReason) {
        ObjectNode handoff = StructuredJson.MAPPER.createObjectNode().put("end_reason", endReason);
        return new CoachResult(session, new CoachReply(message, "complete", handoff));
    }

    @Test
    @DisplayName("무료 7번째 답의 코치 말이 상한으로 닫히면 closeReason limit 이고 서버가 고정 한 줄을 붙여 저장한다")
    void theFreeClosingReplyGetsTheFixedLine() {
        CoachSessionSnapshot open = loop("open", "", 7);
        stored(open);
        when(coach.reply(any(), eq("해 볼게요"), eq(conversation))).thenReturn(closingResult(open, "좋아요. 다음 테이크에서는 끝 대사만 상대를 보고 해 봐요.", "turn_budget"));
        when(conversations.appendTurn(any(), anyLong(), any(), anyString(), anyString(), anyString(), any(), anyString(), any(), any()))
                .thenReturn(new Saved(3, "closed", "limit", FREE_CAP));
        var turn = service(FREE).reply(user, conversation, UUID.randomUUID(), "해 볼게요", 2L);
        String expected = "좋아요. 다음 테이크에서는 끝 대사만 상대를 보고 해 봐요.\n" + ConversationService.FREE_LIMIT_NOTE;
        verify(conversations).appendTurn(eq(conversation), eq(2L), any(), anyString(), eq("해 볼게요"), eq(expected), any(),
                eq("closed"), eq("limit"), any());
        assertThat(turn.coachMessage()).isEqualTo(expected);
        assertThat(ConversationService.FREE_LIMIT_NOTE).isEqualTo("무료 코칭은 여기까지예요. Pro는 끝까지 이어서 코칭받을 수 있어요.");
        assertThat(turn.closeReason()).isEqualTo("limit");
        assertThat(turn.replyLimit()).isEqualTo(FREE_CAP);
    }

    @Test
    @DisplayName("Pro 가 24번째에서 상한으로 닫히거나, 무료가 그만으로 닫히면 고정 한 줄을 붙이지 않는다")
    void otherClosingsKeepTheCoachMessage() {
        CoachSessionSnapshot proOpen = loop("open", "", 23);
        stored(proOpen);
        when(coach.reply(any(), eq("네"), eq(conversation))).thenReturn(closingResult(proOpen, "오늘은 여기까지 해요.", "turn_budget"));
        when(conversations.appendTurn(any(), anyLong(), any(), anyString(), anyString(), anyString(), any(), anyString(), any(), any()))
                .thenReturn(new Saved(3, "closed", "limit", 24));
        service(CoachFreeReplies.NONE).reply(user, conversation, UUID.randomUUID(), "네", 2L);
        verify(conversations).appendTurn(any(), anyLong(), any(), anyString(), eq("네"), eq("오늘은 여기까지 해요."), any(),
                eq("closed"), eq("limit"), any());

        CoachSessionSnapshot freeOpen = loop("open", "", 4);
        stored(freeOpen);
        when(coach.reply(any(), eq("그만"), eq(conversation))).thenReturn(closingResult(freeOpen, "오늘은 여기까지 해요.", "actor_finished"));
        when(conversations.appendTurn(any(), anyLong(), any(), anyString(), anyString(), anyString(), any(), anyString(), any(), any()))
                .thenReturn(new Saved(3, "closed", "user_ended", 5));
        service(FREE).reply(user, conversation, UUID.randomUUID(), "그만", 2L);
        verify(conversations).appendTurn(any(), anyLong(), any(), anyString(), eq("그만"), eq("오늘은 여기까지 해요."), any(),
                eq("closed"), eq("user_ended"), any());
    }

    @Test
    @DisplayName("무료 상한으로 닫힌 대화의 이어하기는 409 conversation_limit_reached, Pro 는 지금처럼 다시 연다")
    void resumingAFreeLimitedConversationIsBlocked() {
        stored(loop("closed", "limit", FREE_CAP));
        assertThatThrownBy(() -> service(FREE).resume(user, conversation, null))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(409))
                .hasMessage("conversation_limit_reached");
        stored(loop("closed", "limit", 3));
        assertThatThrownBy(() -> service(FREE).resume(user, conversation, null))
                .as("상한 사유로 닫혔으면 응답 수와 관계없이 막는다").hasMessage("conversation_limit_reached");
        stored(loop("closed", "exhausted", 6));
        assertThatThrownBy(() -> service(FREE).resume(user, conversation, null))
                .as("무료 상한에 가까우면(8 - 2) 막는다").hasMessage("conversation_limit_reached");
        verify(conversations, never()).reopen(any(), anyLong(), any(), any());

        stored(loop("closed", "exhausted", FREE_CAP));
        when(conversations.reopen(eq(conversation), eq(2L), any(), any())).thenReturn(new Saved(3, "open", null, FREE_CAP));
        service(CoachFreeReplies.NONE).resume(user, conversation, null);
        verify(conversations).reopen(eq(conversation), eq(2L), any(), any());
    }

    @Test
    @DisplayName("무료 상한 전에 스스로 닫힌 짧은 대화는 이어 갈 수 있다")
    void aShortFreeConversationCanStillResume() {
        stored(loop("closed", "exhausted", 3));
        when(conversations.reopen(eq(conversation), eq(2L), any(), any())).thenReturn(new Saved(3, "open", null, 3));
        service(FREE).resume(user, conversation, null);
        verify(conversations).reopen(eq(conversation), eq(2L), any(), any());
    }
}
