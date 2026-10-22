package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;

import java.util.List;
import java.util.Locale;

import com.acttub.actingapi.feature.coach.app.PracticeLoopRouter.Before;
import com.acttub.actingapi.feature.coach.app.PracticeLoopRouter.Classified;
import com.acttub.actingapi.feature.coach.app.PracticeLoopRouter.Kind;
import com.acttub.actingapi.feature.coach.app.PracticeLoopRouter.Tally;
import com.acttub.actingapi.integration.llm.StructuredJson;
import org.junit.jupiter.api.Test;

/** 연습 루프 둘째 응답부터의 분기는 코드가 정한다. 마무리 응답은 없고, 끝낼 때는 코치 AI 없이 닫는다. */
class PracticeLoopRouterTest {

    static Before before(int reply, String lastDoing, Kind lastKind, int habit, int point, int method) {
        return new Before(reply, lastDoing, lastKind, new Tally(habit, point, method), List.of(), false, false, false, false);
    }

    static String route(Kind kind, Before b) {
        return PracticeLoopRouter.route(kind, b);
    }

    static Before at(int stage, int reply, String lastDoing, Kind lastKind) {
        return new Before(reply, lastDoing, lastKind, new Tally(0, 0, 0), List.of(), false, false, false, false, stage);
    }

    @Test void theFirstReplyAnswersTheWantQuestionSoTheNextStepIsTheGap() throws Exception {
        var loop = StructuredJson.MAPPER.readTree("{\"statuses\":[\"\"]}");
        var b = PracticeLoopRouter.before(loop, 1);
        assertThat(b.stage()).isEqualTo(2);
        assertThat(route(Kind.ANSWER, b)).isEqualTo(PracticeLoopRouter.GAP);
        assertThat(PracticeLoopRouter.answerField(Kind.ANSWER, b)).isEqualTo("첫 답");
        assertThat(route(Kind.SHORT, b)).isEqualTo(PracticeLoopRouter.EASY);
        assertThat(PracticeLoopRouter.easyGoal(b)).as("짧게 답하면 원하는 것을 쉽게 다시 묻는다").contains("무엇을 얻고 싶었는지");
        assertThat(PracticeLoopRouter.stageAfter(PracticeLoopRouter.EASY, b)).isEqualTo(2);
    }

    @Test void aMisunderstoodQuestionIsAskedAgainDifferentlyWithoutMovingTheStep() {
        var b = at(2, 2, "비추기", null);
        assertThat(route(Kind.MISSED, b)).isEqualTo(PracticeLoopRouter.REASK);
        assertThat(PracticeLoopRouter.stageAfter(PracticeLoopRouter.REASK, b)).isEqualTo(2);
        assertThat(PracticeLoopRouter.answerField(Kind.MISSED, b)).as("엇나간 답은 첫 답으로 적지 않는다").isNull();
        assertThat(PracticeLoopRouter.stageLine(PracticeLoopRouter.REASK, b)).startsWith("1/4 첫 질문");
        assertThat(PracticeLoopRouter.route(Kind.MISSED, at(2, 3, PracticeLoopRouter.REASK, Kind.MISSED), 1)).as("또 엇나가면 보기 둘로").isEqualTo(PracticeLoopRouter.EASY);
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"missed\"]}").kind()).isEqualTo(Kind.MISSED);
        assertThat(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.REASK, null)).startsWith("역할:");
    }

    @Test void theRootProblemPicksItsOwnPathFile() {
        assertThat(DirectVideoPrompts.practiceLoopRoot("2. 목적성이 안 보인다", null)).contains("목적성이 안 보인다", "1단계", "4단계");
        assertThat(DirectVideoPrompts.practiceLoopRoot("3 캐릭터에 대한 이해가 잘못됐다", null)).contains("캐릭터에 대한 이해");
        assertThat(DirectVideoPrompts.practiceLoopRoot("집중을 못 하고 있다", null)).contains("집중을 못 하고 있다");
        assertThat(DirectVideoPrompts.practiceLoopRoot("4", java.util.Locale.ENGLISH)).contains("not believing the situation");
        assertThat(DirectVideoPrompts.practiceLoopRoot("5. 관계가 안 보인다", null)).contains("관계가 안 보인다");
        assertThat(DirectVideoPrompts.practiceLoopRoot("", null)).isEmpty();
        assertThat(DirectVideoPrompts.practiceLoopRoot("모르는 값", null)).isEmpty();
        assertThat(DirectVideoPrompts.practiceLoop()).contains("근본 문제: [", "확인할 대사: [", "이 장면에서 [인물]은 [상대]한테서 결국 뭘 얻어 내고 싶었어요?");
    }

    @Test void aQuestionRightAfterTheWrapUpIsAnsweredAndTheNextMessageCloses() {
        var afterWrap = at(4, 6, PracticeLoopRouter.WRAP_UP, Kind.ANSWER);
        assertThat(route(Kind.EVALUATION, afterWrap)).isEqualTo("짚어주기");
        assertThat(route(Kind.QUESTION, afterWrap)).isEqualTo("답하기");
        assertThat(PracticeLoopRouter.closesNext(Kind.QUESTION, afterWrap)).isTrue();
        // 2026-10-11 13:49 운영: 정리 뒤 "그저 화풀이니까 더 크게 화를 내야"(답함)가 대꾸 없이 닫혔다. 이제 한 번 받아 준다.
        var reading = PracticeLoopRouter.parse("{\"signals\":[\"answered\"]}");
        assertThat(PracticeLoopRouter.route(reading, afterWrap, 0)).isEqualTo("답하기");
        assertThat(PracticeLoopRouter.closesNext(reading, afterWrap)).isTrue();
        var ack = PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"ack\"]}");
        assertThat(PracticeLoopRouter.route(ack, afterWrap, 0)).as("맞장구는 바로 닫는다").isEqualTo(PracticeLoopRouter.END);
        assertThat(PracticeLoopRouter.closesNext(ack, afterWrap)).isFalse();
        assertThat(route(Kind.SHORT, afterWrap)).as("\"네\"처럼 짧은 말도 바로 닫는다").isEqualTo(PracticeLoopRouter.END);
        var ackThenAsk = PracticeLoopRouter.forRouting(PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"ack\",\"question\"]}"), afterWrap);
        assertThat(PracticeLoopRouter.route(ackThenAsk, afterWrap, 0)).as("맞장구 뒤에 물었으면 답한다").isEqualTo("답하기");
        var answered = new Before(7, "답하기", Kind.QUESTION, new Tally(0, 0, 0), List.of(), false, false, false, true, 4);
        assertThat(route(Kind.ANSWER, answered)).as("답한 다음 말이 물음이 아니면 닫는다").isEqualTo(PracticeLoopRouter.END);
        assertThat(route(Kind.SHORT, answered)).isEqualTo(PracticeLoopRouter.END);
        assertThat(PracticeLoopRouter.route(PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"ack\"]}"), answered, 0)).isEqualTo(PracticeLoopRouter.END);
    }

    @Test void feedbackRequestsAreEvaluationsAndGetALongerAnswer() {
        // 10/12 시험 세트 d227c8d4·72d19868: "피드백 해주세요", "아니 피드백을 해달라고"에 한 구절 + 질문만 받았다.
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"not_yet\",\"evaluation\"]}").kind()).isEqualTo(Kind.EVALUATION);
        assertThat(route(Kind.EVALUATION, at(2, 3, "짚어주기", Kind.EVALUATION))).isEqualTo("짚어주기");
        assertThat(DirectVideoPrompts.practiceLoopTask("짚어주기", null)).contains("피드백 틀", "110자");
        assertThat(DirectVideoPrompts.practiceLoopTask("답하기", null)).contains("100자");
        assertThat(DirectVideoPracticeLoop.EXPLAIN_REPLY).isGreaterThan(DirectVideoPracticeLoop.LONG_REPLY);
    }

    @Test void aQuestionAfterTheLastAnswerIsAnsweredBeforeClosing() {
        // 2026-10-11 17:56 운영: 정리 → "나한테 상대역이 없는데?"에 답함 → "?반응을 어케봐?"에 대꾸 없이 "오늘은 여기까지 해요"로 닫혔다.
        var answered = new Before(5, "답하기", Kind.QUESTION, new Tally(0, 0, 0), List.of(), false, false, false, true, 4);
        assertThat(route(Kind.QUESTION, answered)).isEqualTo("답하기");
        assertThat(PracticeLoopRouter.closesNext(Kind.QUESTION, answered)).as("또 답한 다음 말에서 다시 닫기를 본다").isTrue();
        assertThat(route(Kind.METHOD, answered)).isEqualTo("답하기");
        assertThat(route(Kind.EVALUATION, answered)).isEqualTo("짚어주기");
        assertThat(route(Kind.PUSHBACK, answered)).isEqualTo("답하기");
        assertThat(route(Kind.CORRECTION, answered)).isEqualTo("내려놓기");
        assertThat(route(Kind.MISSED, answered)).as("코치 답을 못 알아들었으면 다시 설명한다").isEqualTo("답하기");
        var alsoAsked = PracticeLoopRouter.forRouting(PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"question\"]}"), answered);
        assertThat(PracticeLoopRouter.route(alsoAsked, answered, 0)).as("답하면서 함께 물었어도 답한다").isEqualTo("답하기");
        assertThat(PracticeLoopRouter.closesNext(Kind.ANSWER, answered)).isFalse();
        assertThat(PracticeLoopRouter.closesNext(Kind.STOP, answered)).isFalse();
        assertThat(route(Kind.STOP, answered)).as("그만은 바로 닫는다").isEqualTo(PracticeLoopRouter.END);
        var atLimit = new Before(PracticeLoopRouter.LAST_REPLY, "답하기", Kind.QUESTION, new Tally(0, 0, 0), List.of(), false, false, false, true, 4);
        assertThat(route(Kind.QUESTION, atLimit)).as("상한에서는 물어도 닫는다").isEqualTo(PracticeLoopRouter.END);
    }

    @Test void anAnswerThatEndsWithAQuestionStillMovesTheStep() {
        var c = PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"evaluation\"]}");
        assertThat(c.kind()).isEqualTo(Kind.ANSWER);
        assertThat(c.alsoAsked()).isTrue();
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"not_yet\",\"evaluation\"]}").alsoAsked()).isFalse();
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"not_yet\",\"evaluation\"]}").kind()).isEqualTo(Kind.EVALUATION);
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"not_yet\"]}").kind()).isEqualTo(Kind.SHORT);
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"method\"]}").respond()).isEqualTo("method");
        assertThat(route(c.kind(), at(2, 2, "비추기", null))).isEqualTo(PracticeLoopRouter.GAP);
    }

    @Test void aThinkingNoteWithoutItsOpeningTagIsStillHidden() {
        var parsed = DirectVideoPracticeLoop.parse("이번 목표: 정리\n글자 수: 맞아요, 그거예요. (20자)\n</생각>\n\n<다음 테이크>눈을 보며 말하기</다음 테이크>\n맞아요, 그거예요.\n눈을 보며 말해 봐도 좋아요.");
        assertThat(parsed.message()).isEqualTo("맞아요, 그거예요.\n눈을 보며 말해 봐도 좋아요.");
    }

    @Test void theFirstReplyKeepsOnlyItsQuestionAndAnUnearnedAgreementIsDropped() {
        assertThat(DirectVideoPracticeLoop.onlyFirstQuestion("어머, 비프 연기군요. 도전적인 작품이죠.\n\n이 장면에서 아버지는 어디서 듣고 있었어요?"))
                .isEqualTo("이 장면에서 아버지는 어디서 듣고 있었어요?");
        assertThat(DirectVideoPracticeLoop.onlyFirstQuestion("이 장면에서 뭘 얻어 내고 싶었어요?")).isEqualTo("이 장면에서 뭘 얻어 내고 싶었어요?");
        assertThat(DirectVideoPracticeLoop.withoutAgreement("맞아요, 그거예요.\n처음부터 끝까지 엄마를 보며 따져 봐도 좋아요."))
                .isEqualTo("처음부터 끝까지 엄마를 보며 따져 봐도 좋아요.");
        assertThat(DirectVideoPracticeLoop.withoutAgreement("맞아요.")).isEqualTo("맞아요.");
    }

    @Test void ordinaryAnswersWalkTheFiveSteps() {
        assertThat(route(Kind.ANSWER, at(1, 2, "비추기", null))).isEqualTo(PracticeLoopRouter.WANT);
        assertThat(route(Kind.CHOICE, at(2, 3, PracticeLoopRouter.WANT, Kind.ANSWER))).isEqualTo(PracticeLoopRouter.GAP);
        assertThat(route(Kind.ANSWER, at(3, 4, PracticeLoopRouter.GAP, Kind.ANSWER))).isEqualTo(PracticeLoopRouter.FIND);
        assertThat(route(Kind.ANSWER, at(4, 5, PracticeLoopRouter.FIND, Kind.ANSWER))).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouter.route(PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"ack\"]}"),
                at(4, 6, PracticeLoopRouter.WRAP_UP, Kind.ANSWER), 0)).as("정리한 다음 맞장구에서 닫는다").isEqualTo(PracticeLoopRouter.END);
        assertThat(PracticeLoopRouter.stageAfter(PracticeLoopRouter.GAP, at(2, 3, PracticeLoopRouter.WANT, Kind.ANSWER))).isEqualTo(3);
    }

    @Test void findingStepWrapsUpOnlyWhenTheActorDecidedAnAction() {
        // 2026-10-11 운영 11:11·11:32·01:10: 고민 중·이해 안 됨·전제 반박·피드백 요청도 answered라 바로 정리로 넘어갔다.
        var find = at(4, 5, PracticeLoopRouter.FIND, Kind.ANSWER);
        var torn = PracticeLoopRouter.parse("{\"signals\":[\"answered\"]}");
        assertThat(torn.decided()).isFalse();
        assertThat(PracticeLoopRouter.route(torn, find, 0)).as("고민 중이면 바꿔 묻는다").isEqualTo(PracticeLoopRouter.REASK);
        assertThat(PracticeLoopRouter.route(torn, find, 1)).as("또 못 정하면 같은 걸 다시 묻지 않고 정리에서 코치가 행동을 준다").isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouter.route(torn, find, 2)).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouter.route(torn, at(4, 8, PracticeLoopRouter.PROPOSE, Kind.ANSWER), 3))
                .as("제안 뒤에는 정리로 간다(끝없이 머물지 않는다)").isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouter.route(PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"question\"]}"), find, 0))
                .as("헷갈려 물으면 먼저 답하고 머문다").isEqualTo("답하기");
        assertThat(PracticeLoopRouter.route(PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"evaluation\"]}"), find, 0))
                .as("피드백을 달라면 판단을 주고 머문다").isEqualTo("짚어주기");
        assertThat(PracticeLoopRouter.stageAfter("짚어주기", find)).isEqualTo(4);
        assertThat(PracticeLoopRouter.route(PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"method\"]}"), find, 0))
                .as("방법을 물으면 정리에서 행동을 준다").isEqualTo(PracticeLoopRouter.WRAP_UP);
        var decided = PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"decided\"]}");
        assertThat(PracticeLoopRouter.route(decided, find, 0)).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouter.answerField(decided, find)).isEqualTo("찾은 대안");
        assertThat(PracticeLoopRouter.answerField(torn, find)).as("정하지 않은 말은 찾은 대안으로 남기지 않는다").isNull();
        assertThat(PracticeLoopRouter.route(torn, at(3, 4, PracticeLoopRouter.GAP, Kind.ANSWER), 0)).as("문턱은 4단계에만").isEqualTo(PracticeLoopRouter.FIND);
        assertThat(PracticeLoopRouter.answerField(torn, at(3, 4, PracticeLoopRouter.GAP, Kind.ANSWER))).isEqualTo("알아챈 것");
        assertThat(route(Kind.ANSWER, find)).as("판단이 없는 분류(버튼·실패)는 예전처럼 정리").isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouter.SIGNALS).contains("decided", "ack");
        assertThat(DirectVideoPrompts.practiceLoopClassifier()).contains("decided:", "ack:");
    }

    @Test void questionsCorrectionsAndPushbackAreAnsweredWithoutMovingTheStep() {
        var b = at(3, 4, PracticeLoopRouter.GAP, Kind.ANSWER);
        assertThat(route(Kind.EVALUATION, b)).isEqualTo("짚어주기");
        assertThat(route(Kind.QUESTION, b)).isEqualTo("답하기");
        assertThat(route(Kind.CORRECTION, b)).isEqualTo("내려놓기");
        assertThat(route(Kind.PUSHBACK, b)).isEqualTo("짚어주기(다른 쪽)");
        assertThat(PracticeLoopRouter.stageAfter("짚어주기", b)).isEqualTo(3);
        assertThat(route(Kind.METHOD, b)).as("방법을 물으면 정리에서 행동을 준다").isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(route(Kind.METHOD, at(2, 2, "비추기", null))).as("문제를 보여 주기 전이면 먼저 보여 준다").isEqualTo(PracticeLoopRouter.GAP);
        var dropped = new Before(4, "내려놓기", Kind.CORRECTION, new Tally(0, 0, 0), List.of("고개"), true, false, false, false, 2);
        assertThat(route(Kind.EVALUATION, dropped)).as("정정 뒤에도 평가를 물으면 판단을 준다(10/20 운영)").isEqualTo("짚어주기");
        var pushedBack = new Before(4, "짚어주기(다른 쪽)", Kind.PUSHBACK, new Tally(0, 0, 0), List.of("고개"), true, false, false, false, 2);
        assertThat(route(Kind.PUSHBACK, pushedBack)).as("반박이 이어지면 같은 할 일을 되풀이하지 않는다(10/17 운영)").isEqualTo("짚어주기");
    }

    @Test void whyQuestionsAreAnsweredBeforeCorrectionsOrTheStep() {
        var why = PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"correction\",\"why\"]}");
        assertThat(why.kind()).as("근거를 물으면 정정보다 먼저 답한다").isEqualTo(Kind.QUESTION);
        assertThat(why.respond()).isEqualTo(PracticeLoopRouter.WHY);
        var gap = at(3, 3, PracticeLoopRouter.GAP, Kind.ANSWER);
        assertThat(PracticeLoopRouter.route(why, gap, 0, CoachFlows.B)).as("흐름 B에서도 정리로 건너뛰지 않고 답한다").isEqualTo("답하기");
        var afterWrap = at(4, 6, PracticeLoopRouter.WRAP_UP, Kind.ANSWER);
        assertThat(PracticeLoopRouter.forRouting(why, afterWrap).respond()).isEqualTo(PracticeLoopRouter.WHY);
        var proposed = at(3, 5, PracticeLoopRouter.PROPOSE, Kind.SHORT);
        assertThat(route(Kind.QUESTION, proposed)).as("제안 뒤 물음에도 먼저 답한다").isEqualTo("답하기");
        assertThat(DirectVideoPrompts.practiceLoopClassifier()).contains("- why:");
        assertThat(DirectVideoCoach.agreeable(Kind.PUSHBACK)).isFalse();
        assertThat(DirectVideoCoach.agreeable(Kind.ANSWER)).isTrue();
        assertThat(DirectVideoCoach.asksForAnother("다른 피드백은")).isTrue();
        assertThat(DirectVideoCoach.asksForAnother("또 다른건")).isTrue();
        assertThat(DirectVideoCoach.asksForAnother("지금 연기는 괜찮았어 ??")).isFalse();
    }

    @Test void shortAnswersInsightsAndLimits() {
        assertThat(route(Kind.SHORT, at(1, 2, "비추기", null))).isEqualTo(PracticeLoopRouter.EASY);
        assertThat(PracticeLoopRouter.stageAfter(PracticeLoopRouter.EASY, at(1, 2, "비추기", null))).isEqualTo(2);
        assertThat(PracticeLoopRouter.easyGoal(at(1, 2, "비추기", null))).contains("무엇을 얻고 싶었는지");
        assertThat(PracticeLoopRouter.route(Kind.SHORT, at(2, 3, PracticeLoopRouter.EASY, Kind.SHORT), 1)).as("두 번째 모름이면 코치가 제안").isEqualTo(PracticeLoopRouter.PROPOSE);
        assertThat(PracticeLoopRouter.route(Kind.SHORT, at(3, 5, PracticeLoopRouter.PROPOSE, Kind.SHORT), 2)).as("제안을 받으면 다음 단계").isEqualTo(PracticeLoopRouter.FIND);
        assertThat(route(Kind.INSIGHT, at(2, 3, PracticeLoopRouter.WANT, Kind.ANSWER))).isEqualTo(PracticeLoopRouter.GAP);
        assertThat(route(Kind.INSIGHT, at(3, 4, PracticeLoopRouter.GAP, Kind.ANSWER))).as("3단계에서 알아채면 스스로 찾기").isEqualTo(PracticeLoopRouter.FIND);
        assertThat(route(Kind.INSIGHT, at(4, 5, PracticeLoopRouter.FIND, Kind.ANSWER))).isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(route(Kind.SELF_LINE, at(3, 4, PracticeLoopRouter.GAP, Kind.ANSWER))).isEqualTo(PracticeLoopRouter.FIND);
        assertThat(route(Kind.STOP, at(2, 3, PracticeLoopRouter.WANT, Kind.ANSWER))).isEqualTo(PracticeLoopRouter.END);
        int last = PracticeLoopRouter.LAST_REPLY;
        assertThat(route(Kind.QUESTION, at(2, last - 1, "답하기", Kind.QUESTION))).as("상한 직전은 정리").isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(route(Kind.QUESTION, at(2, last, PracticeLoopRouter.WRAP_UP, Kind.QUESTION))).isEqualTo(PracticeLoopRouter.END);
        assertThat(route(Kind.ANSWER, at(2, 6, "마무리1", Kind.ANSWER))).as("예전 마무리 뒤").isEqualTo(PracticeLoopRouter.END);
    }

    @Test void beforeRecountsFromStoredStatusesIncludingOldModelWrittenOnes() throws Exception {
        var loop = StructuredJson.MAPPER.readTree("""
                {"design":"버릇: 고개를 크게 돌림 | 곳1: x","statuses":["",
                 "배우의 말: 답\\n지금까지: 같은 버릇 질문 9번\\n할 일: 원하는 것 묻기\\n피할 것: 없음\\n단계: 2",
                 "배우의 말: 정정\\n할 일: 내려놓기\\n피할 것: 고개를 크게 돌림\\n단계: 2",
                 "배우의 말: 평가 요청\\n할 일: 짚어주기(다른 쪽)\\n피할 것: 고개를 크게 돌림, \\"가\\" 구간\\n단계: 2"]}
                """);
        var b = PracticeLoopRouter.before(loop, 4);
        assertThat(b.reply()).isEqualTo(5);
        assertThat(b.stage()).isEqualTo(2);
        assertThat(b.lastDoing()).isEqualTo("짚어주기(다른 쪽)");
        assertThat(b.lastKind()).isEqualTo(Kind.EVALUATION);
        assertThat(b.habitDropped()).isTrue();
        assertThat(b.avoid()).containsExactly("고개를 크게 돌림", "\"가\" 구간");
        // 단계 칸이 없던 예전 대화는 질문 횟수로 짐작한다.
        var old = StructuredJson.MAPPER.readTree("{\"statuses\":[\"\", \"할 일: 파고들기\", \"할 일: 이어보기\"]}");
        assertThat(PracticeLoopRouter.before(old, 3).stage()).as("첫 응답 뒤 2단계에서 질문 두 번").isEqualTo(4);
    }

    @Test void anAnswerWithAQuestionRightAfterTheWrapUpIsAnswered() {
        var afterWrap = at(4, 6, PracticeLoopRouter.WRAP_UP, Kind.ANSWER);
        var c = PracticeLoopRouter.forRouting(PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"method\"]}"), afterWrap);
        assertThat(c.kind()).isEqualTo(Kind.METHOD);
        assertThat(route(c.kind(), afterWrap)).isEqualTo("답하기");
        var midway = at(2, 2, "비추기", null);
        assertThat(PracticeLoopRouter.forRouting(PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"method\"]}"), midway).kind()).isEqualTo(Kind.ANSWER);
    }

    @Test void stayingInTheSameStepChangesHowTheCoachAsksEachTime() throws Exception {
        var b = at(2, 2, "비추기", null);
        assertThat(PracticeLoopRouter.route(Kind.MISSED, b, 0)).isEqualTo(PracticeLoopRouter.REASK);
        assertThat(PracticeLoopRouter.route(Kind.MISSED, b, 1)).isEqualTo(PracticeLoopRouter.EASY);
        assertThat(PracticeLoopRouter.route(Kind.MISSED, b, 2)).as("두 번 머물렀으면 코치가 답을 제안").isEqualTo(PracticeLoopRouter.PROPOSE);
        assertThat(PracticeLoopRouter.route(Kind.SHORT, b, 0)).isEqualTo(PracticeLoopRouter.EASY);
        assertThat(PracticeLoopRouter.route(Kind.SHORT, b, 1)).isEqualTo(PracticeLoopRouter.PROPOSE);
        assertThat(PracticeLoopRouter.route(Kind.QUESTION, b, 2)).as("물음은 몇 번째든 답한다").isEqualTo("답하기");
        assertThat(PracticeLoopRouter.route(Kind.EVALUATION, b, 2)).as("피드백 요청도 몇 번째든 답한다").isEqualTo("짚어주기");
        var proposed = at(2, 5, PracticeLoopRouter.PROPOSE, Kind.SHORT);
        assertThat(PracticeLoopRouter.route(Kind.SHORT, proposed, 3)).as("제안을 받으면 다음 단계").isEqualTo(PracticeLoopRouter.GAP);
        var loop = StructuredJson.MAPPER.readTree("{\"statuses\":[\"\", \"할 일: 다시 묻기\", \"할 일: 쉽게 묻기\"]}");
        assertThat(PracticeLoopRouter.stayed(loop, 3)).isEqualTo(2);
        var moved = StructuredJson.MAPPER.readTree("{\"statuses\":[\"\", \"할 일: 다시 묻기\", \"할 일: 어긋남 보기\"]}");
        assertThat(PracticeLoopRouter.stayed(moved, 3)).isEqualTo(0);
        assertThat(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.PROPOSE, null)).startsWith("역할:");
    }

    @Test void afterTheWrapUpPushbackAndCorrectionAreAnsweredOnce() {
        var afterWrap = at(4, 6, PracticeLoopRouter.WRAP_UP, Kind.ANSWER);
        assertThat(route(Kind.PUSHBACK, afterWrap)).isEqualTo("답하기");
        assertThat(route(Kind.CORRECTION, afterWrap)).as("정리를 아니라고 하면 새 해석 대신 배우 해석을 묻는다(10/20 운영)").isEqualTo("내려놓기");
        var letGoAfterWrap = new Before(8, "내려놓기", Kind.CORRECTION, new Tally(0, 0, 0), List.of(), true, false, false, true, 4);
        assertThat(route(Kind.ANSWER, letGoAfterWrap)).as("배우가 해석을 말하면 그 말로 다시 정리한다").isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(route(Kind.SHORT, letGoAfterWrap)).isEqualTo(PracticeLoopRouter.END);
        var withReading = PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"correction\",\"want\"]}");
        assertThat(PracticeLoopRouter.route(withReading, afterWrap, 0)).as("해석을 말하며 정정하면 그 해석으로 마지막 말을 한다").isEqualTo("답하기");
        var ackAfterLetGo = PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"ack\"]}");
        assertThat(PracticeLoopRouter.route(ackAfterLetGo, letGoAfterWrap, 0)).as("맞장구면 다시 정리하지 않고 닫는다").isEqualTo(PracticeLoopRouter.END);
        assertThat(PracticeLoopRouter.closesNext(Kind.PUSHBACK, afterWrap)).isTrue();
        assertThat(route(Kind.SHORT, afterWrap)).isEqualTo(PracticeLoopRouter.END);
    }

    @Test void theClassifierOutputIsChecked() {
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"correction\"]}").kind()).as("보기 순서가 앞선 것")
                .isEqualTo(Kind.CORRECTION);
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"stop\"]}").kind()).isEqualTo(Kind.STOP);
        assertThatThrownBy(() -> PracticeLoopRouter.parse("{\"signals\":[\"intention\"]}")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> PracticeLoopRouter.parse("{\"signals\":[\"keep\"]}")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test void everyActionTheRouterCanPickHasItsOwnSituationFileInBothLanguages() {
        for (String doing : List.of(PracticeLoopRouter.WANT, PracticeLoopRouter.GAP, PracticeLoopRouter.FIND, PracticeLoopRouter.EASY, PracticeLoopRouter.REASK, PracticeLoopRouter.PROPOSE,
                PracticeLoopRouter.WRAP_UP, "짚어주기", "짚어주기(다른 쪽)", "내려놓기", "답하기")) {
            assertThat(DirectVideoPrompts.practiceLoopTask(doing, null)).as(doing).startsWith("역할:").contains("이번 목표:", "도움이 되는 말:", "피할 말:", "좋은 예");
            assertThat(DirectVideoPrompts.practiceLoopTask(doing, Locale.ENGLISH)).as(doing + " en").isNotBlank();
        }
        assertThat(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.WRAP_UP, null)).contains("<다음 테이크>");
        assertThatThrownBy(() -> DirectVideoPrompts.practiceLoopTask("없는 일", null)).isInstanceOf(IllegalStateException.class);
    }

    @Test void theInstructionCarriesOnlyTheSituationNotTheActionNameOrCounts() {
        String task = DirectVideoPrompts.practiceLoopTask("짚어주기", null);
        String text = PracticeLoopRouter.instruction(null, "짚어주기", List.of("고개를 크게 돌림"), "화면·음성", "확인됨", task);
        assertThat(text).startsWith("[이번 응답]\n역할:").contains("이번 목표:", "모양:", "좋은 예", "다시 꺼내지 않을 것: 고개를 크게 돌림",
                "관찰 근거: 화면·음성", "대사 확인: 확인됨")
                .doesNotContain("할 일:", "배우의 말:", "지금까지:", "쓰는 법:", "- 짚어주기:");
        var classified = new Classified(Kind.SELF_LINE, false, "model");
        String status = PracticeLoopRouter.status("화면·음성", "확인됨", classified, before(6, "이어보기", Kind.ANSWER, 3, 0, 0),
                PracticeLoopRouter.END, null, List.of(), "");
        assertThat(DirectVideoPracticeLoop.statusField(status, "할 일")).isEqualTo("끝");
        assertThat(DirectVideoPracticeLoop.statusField(status, "배우의 말")).isEqualTo("자기 한 줄");
        assertThat(DirectVideoPracticeLoop.finished(new DirectVideoPracticeLoop.Parsed("", status, "x"))).isTrue();
    }

    @Test void aWantSaidInsteadOfAnActionIsKeptAndProposedNotAskedAsAChoice() {
        // 2026-10-13 18:59 운영: 4단계에서 "위로받고 싶어"는 행동이 아니라 저장되지 않았고, 보기 둘("울컥하는지, 비웃어주는지")로 코치 낱말이 끼어들었다.
        var find = at(4, 8, PracticeLoopRouter.FIND, Kind.ANSWER);
        var want = PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"want\"]}");
        assertThat(want.want()).isTrue();
        assertThat(want.decided()).isFalse();
        // 2026-10-22 00:16 운영(자문): 바람을 말했는데도 "장면 내내 뭘 해 볼래요?"를 말만 바꿔 다시 물었다.
        assertThat(PracticeLoopRouter.route(want, find, 0)).as("바람을 말했으면 다시 묻지 않고 정리에서 그 바람을 얻을 행동을 준다").isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(PracticeLoopRouter.route(want, find, 1)).isEqualTo(PracticeLoopRouter.WRAP_UP);
        var torn = PracticeLoopRouter.parse("{\"signals\":[\"answered\"]}");
        assertThat(PracticeLoopRouter.route(torn, find, 0)).as("바람이 없으면 한 번은 바꿔 묻는다").isEqualTo(PracticeLoopRouter.REASK);
        assertThat(PracticeLoopRouter.route(torn, find, 1)).as("두 번째는 보기 둘 없이 정리").isEqualTo(PracticeLoopRouter.WRAP_UP);

        String status = PracticeLoopRouter.status("", "", want, find, PracticeLoopRouter.REASK, null, List.of(), "", false, "설득도 있지만  위로받고 싶어해");
        assertThat(DirectVideoPracticeLoop.statusField(status, PracticeLoopRouter.WANT_FIELD)).isEqualTo("설득도 있지만 위로받고 싶어해");
        assertThat(DirectVideoPracticeLoop.statusField(status, PracticeLoopRouter.LINE_FIX_FIELD)).isEmpty();

        var loop = StructuredJson.MAPPER.createObjectNode();
        var statuses = loop.putArray("statuses");
        statuses.add("할 일: 비추기");
        statuses.add("할 일: 어긋남 보기\n" + PracticeLoopRouter.WANT_FIELD + ": 공감받고 싶어");
        statuses.add(status);
        statuses.add("할 일: 답하기");
        assertThat(PracticeLoopRouter.latestWant(loop, 4)).as("가장 나중 바람").isEqualTo("설득도 있지만 위로받고 싶어해");
        assertThat(PracticeLoopRouter.latestWant(loop, 2)).isEqualTo("공감받고 싶어");
        assertThat(PracticeLoopRouter.lineFixed(loop, 4)).isFalse();
    }

    @Test void aCorrectedLineIsRememberedForTheRestOfTheTalk() {
        // 2026-10-13 18:59 운영: "그건 교수 흉내 부분이야" 뒤에도 정리가 같은 대사를 세 번 썼다.
        var fix = PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"correction\",\"line_fix\",\"want\"]}");
        assertThat(fix.kind()).isEqualTo(Kind.CORRECTION);
        assertThat(fix.lineFix()).isTrue();
        assertThat(fix.want()).as("정정과 함께 붙은 바람도 남는다").isTrue();
        var wrapped = at(5, 10, PracticeLoopRouter.WRAP_UP, Kind.ANSWER);
        var asked = PracticeLoopRouter.forRouting(PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"question\",\"line_fix\"]}"), wrapped);
        assertThat(asked.kind()).isEqualTo(Kind.QUESTION);
        assertThat(asked.lineFix()).as("정리 뒤 물음으로 바꿔도 표시는 남는다").isTrue();
        String status = PracticeLoopRouter.status("", "", fix, wrapped, "답하기", null, List.of(), "", true, "그건 흉내 내는 부분이야");
        var loop = StructuredJson.MAPPER.createObjectNode();
        loop.putArray("statuses").add("할 일: 비추기").add(status).add("할 일: 답하기");
        assertThat(PracticeLoopRouter.lineFixed(loop, 3)).isTrue();
        assertThat(PracticeLoopRouter.lineFixed(loop, 1)).isFalse();
        assertThat(PracticeLoopRouter.SIGNALS).contains("want", "line_fix");
        assertThat(DirectVideoPrompts.practiceLoopClassifier()).contains("want:", "line_fix:");
    }

    @Test void flowBSkipsFindingAndGoesStraightToWrapUpAfterTheCoachSaysWhatItSaw() {
        var classified = new Classified(Kind.ANSWER, false, "model");
        var afterGap = at(3, 4, PracticeLoopRouter.GAP, Kind.ANSWER);
        assertThat(PracticeLoopRouter.route(classified, afterGap, 0, CoachFlows.A)).isEqualTo(PracticeLoopRouter.FIND);
        assertThat(PracticeLoopRouter.route(classified, afterGap, 0, CoachFlows.B)).isEqualTo(PracticeLoopRouter.WRAP_UP);
        var afterFirst = at(2, 2, "원하는 것 묻기", Kind.ANSWER);
        assertThat(PracticeLoopRouter.route(classified, afterFirst, 0, CoachFlows.B))
                .isEqualTo(PracticeLoopRouter.route(classified, afterFirst, 0, CoachFlows.A));
        var correction = new Classified(Kind.CORRECTION, false, "model");
        assertThat(PracticeLoopRouter.route(correction, afterGap, 0, CoachFlows.B)).as("정정은 B도 먼저 받는다").isEqualTo("내려놓기");
    }

    @Test void flowBTellsInsteadOfQuizzingAndCarriesTheThreeStepNote() {
        var b = at(2, 2, "원하는 것 묻기", Kind.ANSWER);
        assertThat(PracticeLoopRouter.stageLine(PracticeLoopRouter.GAP, b, CoachFlows.B)).startsWith("2/4 코치가 본 것");
        assertThat(PracticeLoopRouter.stageLine(PracticeLoopRouter.GAP, b, CoachFlows.A)).isEqualTo(PracticeLoopRouter.stageLine(PracticeLoopRouter.GAP, b));
        assertThat(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.GAP, null, CoachFlows.B)).contains("솔직하게 말해 주는 연출가");
        assertThat(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.GAP, null, CoachFlows.A))
                .isEqualTo(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.GAP, null));
        assertThat(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.GAP, java.util.Locale.ENGLISH, CoachFlows.B)).contains("root problem");
        assertThat(DirectVideoPrompts.flowBlock(CoachFlows.B, null)).contains("세 단계");
        assertThat(DirectVideoPrompts.flowBlock(CoachFlows.A, null)).isEmpty();
        assertThat(DirectVideoPrompts.flowBlock(CoachFlows.B, java.util.Locale.ENGLISH)).isEmpty();
    }
}
