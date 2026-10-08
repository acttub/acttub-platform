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

/** 연습 루프 둘째 응답부터의 분기는 코드가 정한다. 예전 프롬프트의 할 일 표를 그대로 옮긴 것을 고정한다. */
class PracticeLoopRouterTest {

    static Before before(int reply, String lastDoing, Kind lastKind, int habit, int point, int method) {
        return new Before(reply, lastDoing, lastKind, new Tally(habit, point, method), List.of(), false, false, false);
    }

    static String route(Kind kind, Before b) {
        return PracticeLoopRouter.route(kind, b, false);
    }

    @Test void endsAndClosingsComeFirst() {
        var mid = before(4, "이어보기", Kind.ANSWER, 3, 0, 0);
        assertThat(route(Kind.STOP, mid)).isEqualTo("끝");
        assertThat(PracticeLoopRouter.route(Kind.STOP, mid, true)).as("그만 + 다음 방법").isEqualTo("마무리2");
        assertThat(route(Kind.ANSWER, before(5, "마무리2", Kind.SELF_LINE, 3, 0, 0))).isEqualTo("끝");
        assertThat(route(Kind.SELF_LINE, mid)).isEqualTo("마무리2");
        assertThat(route(Kind.EVALUATION, before(6, "마무리1", Kind.ANSWER, 3, 0, 0))).as("한 줄을 청한 뒤의 답").isEqualTo("마무리2");
        assertThat(route(Kind.CORRECTION, before(15, "이어보기", Kind.ANSWER, 3, 0, 0))).isEqualTo("마무리1");
        assertThat(route(Kind.CORRECTION, before(16, "이어보기", Kind.ANSWER, 3, 0, 0))).isEqualTo("마무리2");
    }

    @Test void correctionsPushbackAndRequestsAreAnsweredInsteadOfQuestionedAgain() {
        var b = before(3, "파고들기", Kind.ANSWER, 2, 0, 0);
        assertThat(route(Kind.CORRECTION, b)).isEqualTo("내려놓기");
        assertThat(route(Kind.PUSHBACK, b)).isEqualTo("짚어주기(다른 쪽)");
        assertThat(route(Kind.METHOD, b)).isEqualTo("방법 주기");
        assertThat(route(Kind.METHOD, before(5, "방법 주기", Kind.METHOD, 2, 0, 2))).isEqualTo("마무리2");
        assertThat(route(Kind.EVALUATION, b)).isEqualTo("짚어주기");
        assertThat(route(Kind.EVALUATION, before(5, "짚어주기", Kind.EVALUATION, 2, 2, 0))).isEqualTo("방법 주기");
        var dropped = new Before(4, "내려놓기", Kind.CORRECTION, new Tally(2, 0, 0), List.of("고개를 크게 돌림"), true, false, false);
        assertThat(route(Kind.EVALUATION, dropped)).as("정정한 버릇은 다시 짚지 않는다").isEqualTo("짚어주기(다른 쪽)");
    }

    @Test void ordinaryAnswersMoveThroughTheHabitAndStopAtThree() {
        assertThat(route(Kind.ANSWER, before(2, "비추기", null, 1, 0, 0))).isEqualTo("파고들기");
        assertThat(route(Kind.ANSWER, before(3, "파고들기", Kind.ANSWER, 2, 0, 0))).isEqualTo("이어보기");
        assertThat(route(Kind.ANSWER, before(4, "이어보기", Kind.ANSWER, 3, 0, 0))).as("같은 버릇을 네 번 묻지 않는다").isEqualTo("마무리1");
        assertThat(route(Kind.CHOICE, before(3, "파고들기", Kind.ANSWER, 2, 0, 0))).isEqualTo("이어보기(선택)");
        assertThat(route(Kind.CHOICE, before(4, "이어보기", Kind.ANSWER, 3, 0, 0))).isEqualTo("마무리1");
        assertThat(route(Kind.INSIGHT, before(3, "파고들기", Kind.ANSWER, 2, 0, 0))).isEqualTo("이어보기");
        assertThat(route(Kind.INSIGHT, before(5, "이어보기", Kind.ANSWER, 2, 0, 0))).isEqualTo("마무리1");
        assertThat(route(Kind.QUESTION, before(3, "파고들기", Kind.ANSWER, 2, 0, 0))).isEqualTo("답하기");
        assertThat(route(Kind.SHORT, before(2, "비추기", null, 1, 0, 0))).isEqualTo("파고들기(쉬운)");
        assertThat(route(Kind.SHORT, before(3, "파고들기(쉬운)", Kind.SHORT, 2, 0, 0))).as("짧은 답이 두 번이면 본 것을 먼저 말한다")
                .isEqualTo("짚어주기");
        assertThat(route(Kind.SHORT, before(6, "짚어주기", Kind.SHORT, 2, 2, 0))).isEqualTo("마무리1");
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

    @Test void codeRulesCatchOnlyTheObviousAndTheClassifierOutputIsChecked() {
        assertThat(PracticeLoopRouter.byRule("그만").kind()).isEqualTo(Kind.STOP);
        assertThat(PracticeLoopRouter.byRule("오늘은 여기까지 할게요").kind()).isEqualTo(Kind.STOP);
        assertThat(PracticeLoopRouter.byRule("몰라요").kind()).isEqualTo(Kind.SHORT);
        assertThat(PracticeLoopRouter.byRule("네").by()).isEqualTo("code");
        assertThat(PracticeLoopRouter.byRule("카메라 렌즈 본 거예요")).isNull();
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"answer\",\"correction\"]}").kind()).as("보기 순서가 앞선 것")
                .isEqualTo(Kind.CORRECTION);
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"self_line\",\"keep\"]}")).isEqualTo(new Classified(Kind.SELF_LINE, true, "model"));
        assertThatThrownBy(() -> PracticeLoopRouter.parse("{\"signals\":[\"intention\"]}")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> PracticeLoopRouter.parse("{\"signals\":[\"keep\"]}")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test void everyActionTheRouterCanPickHasWritingInstructionsInBothLanguages() {
        for (String doing : List.of("파고들기", "파고들기(쉬운)", "이어보기", "이어보기(선택)", "마무리1", "마무리2", "짚어주기",
                "짚어주기(다른 쪽)", "방법 주기", "내려놓기", "답하기", "끝")) {
            for (Locale language : java.util.Arrays.asList(null, Locale.ENGLISH)) {
                String task = DirectVideoPrompts.practiceLoopTask(doing, language);
                assertThat(task).as(doing + " " + language).startsWith("- " + doing + ":");
            }
        }
        assertThat(DirectVideoPrompts.practiceLoopTask("짚어주기", null)).doesNotContain("짚어주기(다른 쪽):");
        assertThat(DirectVideoPrompts.practiceLoopTask("마무리2", null)).contains("<다음 테이크>", "3줄:");
        assertThatThrownBy(() -> DirectVideoPrompts.practiceLoopTask("없는 일", null)).isInstanceOf(IllegalStateException.class);
    }

    @Test void theInstructionNamesOnlyTheChosenActionAndTheStatusKeepsTheFieldsNotesRead() {
        var b = new Before(6, "마무리1", Kind.ANSWER, new Tally(3, 0, 0), List.of(), false, true, false);
        var classified = new Classified(Kind.ANSWER, false, "model");
        String text = PracticeLoopRouter.instruction(null, "마무리2", classified, b, null, List.of(), "화면·음성", "확인됨",
                "나는 쉬면서 버티는 배우", "말을 이어서 하기", DirectVideoPrompts.practiceLoopTask("마무리2", null));
        assertThat(text).startsWith("[이번 응답]\n할 일: 마무리2").contains("배우의 한 줄: 나는 쉬면서 버티는 배우",
                "다음 테이크: 지키며", "이번이 응답 6번째").doesNotContain("반대로: 말을 이어서 하기");
        String status = PracticeLoopRouter.status("화면·음성", "확인됨", classified, b, "마무리2", null, List.of(), "지키며: 쉼 동안 상대 보기");
        assertThat(DirectVideoPracticeLoop.statusField(status, "할 일")).isEqualTo("마무리2");
        assertThat(DirectVideoPracticeLoop.statusField(status, "배우의 말")).isEqualTo("답");
        assertThat(DirectVideoPracticeLoop.finished(new DirectVideoPracticeLoop.Parsed("", status, "x"))).isTrue();
        assertThat(DirectVideoPracticeLoop.closingNextTake(StructuredJson.MAPPER.createArrayNode().add(status)))
                .isEqualTo("쉼 동안 상대 보기");
    }
}
