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

/**
 * SOMA-855: 배우가 "이미 그렇게 했다"고 하면 실험 쪽은 의도를 다시 묻지 않고 한 일을 한 번 묻고, 그다음 다른 행동으로 정리한다.
 * 2026-10-25 02:26 운영(자문 75d33331): 정정 → 내려놓기(의도 다시 묻기) → 정리하기(같은 제안)가 세 번 되풀이됐다.
 */
class PracticeLoopAlreadyTest {

    static Before at(int stage, int reply, String lastDoing, Kind lastKind, boolean closeNext) {
        return new Before(reply, lastDoing, lastKind, new Tally(1, 1, 0), List.of(), false, false, false, closeNext, stage);
    }

    @Test void theClassifierMarksAlready() {
        var c = PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"correction\",\"already\"]}");
        assertThat(c.kind()).isEqualTo(Kind.CORRECTION);
        assertThat(c.already()).isTrue();
        assertThat(PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"correction\"]}").already()).isFalse();
        assertThat(PracticeLoopRouter.SIGNALS).contains("already");
    }

    @Test void forRoutingKeepsAlready() {
        var b = at(4, 7, PracticeLoopRouter.WRAP_UP, Kind.ANSWER, false);
        var c = PracticeLoopRouter.parse("{\"signals\":[\"answered\",\"question\",\"already\"]}");
        assertThat(PracticeLoopRouter.forRouting(c, b).already()).isTrue();
    }

    @Test void afterAWrapAlreadyAsksWhatWasDoneInsteadOfTheIntentAgain() {
        var b = at(4, 7, PracticeLoopRouter.WRAP_UP, Kind.METHOD, false);
        var c = new Classified(Kind.CORRECTION, false, "model").withAlready(true);
        String control = PracticeLoopRouter.route(c, b, 0);
        assertThat(control).as("대조 쪽은 지금처럼 내려놓기").isEqualTo(PracticeLoopRouter.LET_GO);
        assertThat(PracticeLoopRouter.routeAlready(c, b, control, false)).isEqualTo(PracticeLoopRouter.ASK_DONE);
    }

    @Test void theAnswerToAskDoneWrapsDifferently() {
        var b = at(4, 8, PracticeLoopRouter.ASK_DONE, Kind.CORRECTION, false);
        var answer = new Classified(Kind.ANSWER, false, "model");
        assertThat(PracticeLoopRouter.routeAlready(answer, b, PracticeLoopRouter.route(answer, b, 1), true))
                .isEqualTo(PracticeLoopRouter.WRAP_DONE);
        assertThat(PracticeLoopRouter.WRAP_DONE).startsWith(PracticeLoopRouter.WRAP_UP);
        var stop = new Classified(Kind.STOP, false, "model");
        assertThat(PracticeLoopRouter.routeAlready(stop, b, PracticeLoopRouter.END, true)).isEqualTo(PracticeLoopRouter.END);
    }

    @Test void aSecondAlreadyDoesNotAskTheIntentAgain() {
        var b = at(4, 10, PracticeLoopRouter.WRAP_DONE, Kind.ANSWER, false);
        var c = new Classified(Kind.CORRECTION, false, "model").withAlready(true);
        String control = PracticeLoopRouter.route(c, b, 0);
        assertThat(control).isEqualTo(PracticeLoopRouter.LET_GO);
        assertThat(PracticeLoopRouter.routeAlready(c, b, control, true)).isEqualTo("답하기");
    }

    @Test void afterAnsweringAnAlreadyOnceMoreItCloses() throws Exception {
        var b = at(4, 11, "답하기", Kind.CORRECTION, true);
        var c = new Classified(Kind.CORRECTION, false, "model").withAlready(true);
        assertThat(PracticeLoopRouter.routeAlready(c, b, "답하기", true, true)).isEqualTo(PracticeLoopRouter.END);
        assertThat(PracticeLoopRouter.routeAlready(c, b, "답하기", true, false)).isEqualTo("답하기");
        var loop = StructuredJson.MAPPER.readTree("{\"statuses\":[\"\",\"할 일: 답하기\\n이미 한 것: 달래 봐도 좋아요\"]}");
        assertThat(PracticeLoopRouter.lastWasDone(loop, 2)).isTrue();
        assertThat(PracticeLoopRouter.lastWasDone(loop, 1)).isFalse();
    }

    @Test void withoutAlreadyTheTableIsUnchanged() {
        var b = at(3, 4, PracticeLoopRouter.GAP, Kind.ANSWER, false);
        var c = new Classified(Kind.ANSWER, false, "model");
        String control = PracticeLoopRouter.route(c, b, 0);
        assertThat(PracticeLoopRouter.routeAlready(c, b, control, false)).isEqualTo(control);
    }

    @Test void nearTheReplyLimitItWrapsRightAway() {
        var b = at(4, PracticeLoopRouter.LAST_REPLY - 1, PracticeLoopRouter.WRAP_UP, Kind.ANSWER, false);
        var c = new Classified(Kind.CORRECTION, false, "model").withAlready(true);
        assertThat(PracticeLoopRouter.routeAlready(c, b, PracticeLoopRouter.WRAP_UP, false)).isEqualTo(PracticeLoopRouter.WRAP_DONE);
    }

    @Test void theProposalTheActorAlreadyDidIsRememberedAndGivenAsMaterial() throws Exception {
        var loop = StructuredJson.MAPPER.readTree("{\"statuses\":[\"\",\"할 일: 정리하기\\n다음 테이크: 처음엔 다그치다가 \\\"하지만\\\"부터는 달래 봐도 좋아요.\","
                + "\"할 일: 한 일 묻기\\n이미 한 것: 처음엔 다그치다가 \\\"하지만\\\"부터는 달래 봐도 좋아요.\"]}");
        assertThat(PracticeLoopRouter.lastProposal(loop, 2, "코치 말")).startsWith("처음엔 다그치다가");
        assertThat(PracticeLoopRouter.lastProposal(loop, 1, "직전 코치 말")).isEqualTo("직전 코치 말");
        assertThat(PracticeLoopRouter.askedDone(loop, 3)).isTrue();
        assertThat(PracticeLoopRouter.askedDone(loop, 2)).isFalse();
        var done = PracticeLoopRouter.doneProposals(loop, 3);
        assertThat(done).hasSize(1);
        var materials = PracticeLoopRouter.withDone(List.of("배우가 방금 한 말: 위로"), done, "");
        assertThat(materials).last().asString().contains("다시 제안하지 않는다").contains("다그치다가");
        assertThat(PracticeLoopRouter.withDone(List.of("a"), List.of(), "")).containsExactly("a");
    }

    @Test void bothNewTasksHaveFilesInBothLanguages() {
        for (String doing : List.of(PracticeLoopRouter.ASK_DONE, PracticeLoopRouter.WRAP_DONE)) {
            assertThat(DirectVideoPrompts.practiceLoopTask(doing, Locale.KOREAN)).isNotBlank();
            assertThat(DirectVideoPrompts.practiceLoopTask(doing, Locale.ENGLISH)).isNotBlank();
        }
        assertThat(PracticeLoopRouter.stageLine(PracticeLoopRouter.WRAP_DONE, at(4, 9, PracticeLoopRouter.ASK_DONE, Kind.ANSWER, false)))
                .startsWith("4/4");
    }
}
