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
        assertThat(route(Kind.ANSWER, afterWrap)).isEqualTo(PracticeLoopRouter.END);
        assertThat(PracticeLoopRouter.closesNext(Kind.ANSWER, afterWrap)).isFalse();
        var answered = new Before(7, "답하기", Kind.QUESTION, new Tally(0, 0, 0), List.of(), false, false, false, true, 4);
        assertThat(route(Kind.QUESTION, answered)).as("답한 다음 말에서는 닫는다").isEqualTo(PracticeLoopRouter.END);
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
        assertThat(route(Kind.ANSWER, at(4, 6, PracticeLoopRouter.WRAP_UP, Kind.ANSWER))).as("정리한 다음 말에서 닫는다")
                .isEqualTo(PracticeLoopRouter.END);
        assertThat(PracticeLoopRouter.stageAfter(PracticeLoopRouter.GAP, at(2, 3, PracticeLoopRouter.WANT, Kind.ANSWER))).isEqualTo(3);
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
        assertThat(route(Kind.EVALUATION, dropped)).isEqualTo("짚어주기(다른 쪽)");
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
        assertThat(route(Kind.QUESTION, at(2, 15, "답하기", Kind.QUESTION))).as("15번째는 정리").isEqualTo(PracticeLoopRouter.WRAP_UP);
        assertThat(route(Kind.QUESTION, at(2, 16, PracticeLoopRouter.WRAP_UP, Kind.QUESTION))).isEqualTo(PracticeLoopRouter.END);
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
        assertThat(PracticeLoopRouter.route(Kind.QUESTION, b, 2)).isEqualTo(PracticeLoopRouter.PROPOSE);
        var proposed = at(2, 5, PracticeLoopRouter.PROPOSE, Kind.SHORT);
        assertThat(PracticeLoopRouter.route(Kind.SHORT, proposed, 3)).as("제안을 받으면 다음 단계").isEqualTo(PracticeLoopRouter.GAP);
        var loop = StructuredJson.MAPPER.readTree("{\"statuses\":[\"\", \"할 일: 다시 묻기\", \"할 일: 쉽게 묻기\"]}");
        assertThat(PracticeLoopRouter.stayed(loop, 3)).isEqualTo(2);
        var moved = StructuredJson.MAPPER.readTree("{\"statuses\":[\"\", \"할 일: 다시 묻기\", \"할 일: 어긋남 보기\"]}");
        assertThat(PracticeLoopRouter.stayed(moved, 3)).isEqualTo(0);
        assertThat(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.PROPOSE, null)).startsWith("역할:");
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
}
