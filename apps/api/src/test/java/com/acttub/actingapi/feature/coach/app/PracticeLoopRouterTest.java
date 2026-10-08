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
        return new Before(reply, lastDoing, lastKind, new Tally(habit, point, method), List.of(), false, false, false);
    }

    static String route(Kind kind, Before b) {
        return PracticeLoopRouter.route(kind, b);
    }

    @Test void stopSelfLineAndTheCeilingCloseWithoutACoachReply() {
        var mid = before(4, "이어보기", Kind.ANSWER, 3, 0, 0);
        assertThat(route(Kind.STOP, mid)).isEqualTo(PracticeLoopRouter.END);
        assertThat(route(Kind.SELF_LINE, mid)).isEqualTo(PracticeLoopRouter.END);
        assertThat(route(Kind.CORRECTION, before(16, "이어보기", Kind.ANSWER, 3, 0, 0))).isEqualTo(PracticeLoopRouter.END);
        assertThat(route(Kind.ANSWER, before(15, "이어보기", Kind.ANSWER, 3, 0, 0))).as("15번째는 더 이상 마무리가 아니다")
                .isEqualTo("이어보기");
        // 예전 프롬프트로 마무리까지 간 대화는 다음 답에서 닫는다.
        assertThat(route(Kind.EVALUATION, before(6, "마무리1", Kind.ANSWER, 3, 0, 0))).isEqualTo(PracticeLoopRouter.END);
        assertThat(route(Kind.ANSWER, before(5, "마무리2", Kind.SELF_LINE, 3, 0, 0))).isEqualTo(PracticeLoopRouter.END);
    }

    @Test void correctionsPushbackAndRequestsAreAnsweredInsteadOfQuestionedAgain() {
        var b = before(3, "파고들기", Kind.ANSWER, 2, 0, 0);
        assertThat(route(Kind.CORRECTION, b)).isEqualTo("내려놓기");
        assertThat(route(Kind.PUSHBACK, b)).isEqualTo("짚어주기(다른 쪽)");
        assertThat(route(Kind.METHOD, b)).isEqualTo("방법 주기");
        assertThat(route(Kind.METHOD, before(5, "방법 주기", Kind.METHOD, 2, 0, 2))).as("방법을 또 물으면 또 답한다")
                .isEqualTo("방법 주기");
        assertThat(route(Kind.EVALUATION, b)).isEqualTo("짚어주기");
        assertThat(route(Kind.EVALUATION, before(5, "짚어주기", Kind.EVALUATION, 2, 2, 0))).isEqualTo("방법 주기");
        assertThat(route(Kind.EVALUATION, before(7, "방법 주기", Kind.EVALUATION, 2, 2, 2))).isEqualTo("짚어주기");
        var dropped = new Before(4, "내려놓기", Kind.CORRECTION, new Tally(2, 0, 0), List.of("고개를 크게 돌림"), true, false, false);
        assertThat(route(Kind.EVALUATION, dropped)).as("정정한 버릇은 다시 짚지 않는다").isEqualTo("짚어주기(다른 쪽)");
    }

    @Test void ordinaryAnswersKeepTheConversationGoingWithoutWrappingUp() {
        assertThat(route(Kind.ANSWER, before(2, "비추기", null, 1, 0, 0))).isEqualTo("파고들기");
        assertThat(route(Kind.ANSWER, before(3, "파고들기", Kind.ANSWER, 2, 0, 0))).isEqualTo("이어보기");
        assertThat(route(Kind.ANSWER, before(6, "이어보기", Kind.ANSWER, 5, 0, 0))).isEqualTo("이어보기");
        assertThat(route(Kind.CHOICE, before(3, "파고들기", Kind.ANSWER, 2, 0, 0))).isEqualTo("이어보기(선택)");
        assertThat(route(Kind.CHOICE, before(5, "이어보기", Kind.ANSWER, 4, 0, 0))).isEqualTo("이어보기(선택)");
        assertThat(route(Kind.INSIGHT, before(7, "이어보기", Kind.ANSWER, 4, 0, 0))).isEqualTo("이어보기");
        assertThat(route(Kind.QUESTION, before(3, "파고들기", Kind.ANSWER, 2, 0, 0))).isEqualTo("답하기");
        assertThat(route(Kind.SHORT, before(2, "비추기", null, 1, 0, 0))).isEqualTo("파고들기(쉬운)");
        assertThat(route(Kind.SHORT, before(3, "파고들기(쉬운)", Kind.SHORT, 2, 0, 0))).as("짧은 답이 두 번이면 본 것을 먼저 말한다")
                .isEqualTo("짚어주기");
        assertThat(route(Kind.SHORT, before(6, "짚어주기", Kind.SHORT, 2, 2, 0))).isEqualTo("파고들기(쉬운)");
    }

    @Test void beforeRecountsFromStoredStatusesIncludingOldModelWrittenOnes() throws Exception {
        var loop = StructuredJson.MAPPER.readTree("""
                {"design":"버릇: 고개를 크게 돌림 | 곳1: x","statuses":["",
                 "배우의 말: 답\\n지금까지: 같은 버릇 질문 9번\\n할 일: 파고들기\\n피할 것: 없음",
                 "배우의 말: 정정\\n할 일: 내려놓기\\n피할 것: 고개를 크게 돌림",
                 "배우의 말: 평가 요청\\n할 일: 짚어주기(다른 쪽)\\n피할 것: 고개를 크게 돌림, \\"가\\" 구간"]}
                """);
        var b = PracticeLoopRouter.before(loop, 4);
        assertThat(b.reply()).isEqualTo(5);
        assertThat(b.tally()).as("모델이 적어 둔 숫자(9번)가 아니라 한 일을 다시 센다").isEqualTo(new Tally(2, 1, 0));
        assertThat(b.lastDoing()).isEqualTo("짚어주기(다른 쪽)");
        assertThat(b.lastKind()).isEqualTo(Kind.EVALUATION);
        assertThat(b.habitDropped()).isTrue();
        assertThat(b.avoid()).containsExactly("고개를 크게 돌림", "\"가\" 구간");
        assertThat(PracticeLoopRouter.avoidAfter(before(3, "파고들기", Kind.ANSWER, 2, 0, 0), Kind.PUSHBACK, "말끝을 흐림"))
                .containsExactly("말끝을 흐림");
    }

    @Test void theClassifierOutputIsChecked() {
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"answer\",\"correction\"]}").kind()).as("보기 순서가 앞선 것")
                .isEqualTo(Kind.CORRECTION);
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"self_line\",\"keep\"]}")).isEqualTo(new Classified(Kind.SELF_LINE, true, "model"));
        assertThatThrownBy(() -> PracticeLoopRouter.parse("{\"signals\":[\"intention\"]}")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> PracticeLoopRouter.parse("{\"signals\":[\"keep\"]}")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test void everyActionTheRouterCanPickHasWritingInstructions() {
        for (String doing : List.of("파고들기", "파고들기(쉬운)", "이어보기", "이어보기(선택)", "짚어주기", "짚어주기(다른 쪽)",
                "방법 주기", "내려놓기", "답하기")) {
            for (Locale language : java.util.Arrays.asList(null, Locale.ENGLISH)) {
                assertThat(DirectVideoPrompts.practiceLoopTask(doing, language)).as(doing + " " + language).startsWith("- " + doing + ":");
            }
        }
        assertThat(DirectVideoPrompts.practiceLoopTask("짚어주기", null)).doesNotContain("짚어주기(다른 쪽):");
        assertThatThrownBy(() -> DirectVideoPrompts.practiceLoopTask("없는 일", null)).isInstanceOf(IllegalStateException.class);
    }

    @Test void theInstructionCarriesOnlyTheSituationNotTheActionNameOrCounts() {
        String task = DirectVideoPrompts.practiceLoopTask("짚어주기", null);
        String text = PracticeLoopRouter.instruction(null, "짚어주기", List.of("고개를 크게 돌림"), "화면·음성", "확인됨", task);
        assertThat(text).startsWith("[이번 응답]\n지금 상황:").contains("모양:", "예)", "다시 꺼내지 않을 것: 고개를 크게 돌림",
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
