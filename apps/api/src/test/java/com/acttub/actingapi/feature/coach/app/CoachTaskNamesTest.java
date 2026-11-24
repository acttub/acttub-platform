package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * 할 일·단계 이름의 글자. 상태 칸 「할 일:」에 저장되고 다음 턴·노트·기억이 다시 읽으며, 지시문 파일 이름과 관측 기록 route 칸에도
 * 그대로 쓰인다. 저장된 대화와 어긋나지 않게 글자를 묶어 둔다 — 바꾸려면 저장된 대화를 어떻게 읽을지부터 정해야 한다.
 */
class CoachTaskNamesTest {
    @Test void practiceLoopTaskNamesAreTheStoredText() {
        assertThat(List.of(PracticeLoopRouter.WANT, PracticeLoopRouter.GAP, PracticeLoopRouter.FIND, PracticeLoopRouter.EASY,
                PracticeLoopRouter.REASK, PracticeLoopRouter.PROPOSE, PracticeLoopRouter.POINT_OUT, PracticeLoopRouter.POINT_OUT_OTHER,
                PracticeLoopRouter.ANSWER, PracticeLoopRouter.LET_GO, PracticeLoopRouter.ASK_DONE, PracticeLoopRouter.WRAP_UP,
                PracticeLoopRouter.WRAP_DONE, PracticeLoopRouter.END, PracticeLoopRouter.SHOW))
                .containsExactly("원하는 것 묻기", "어긋남 보기", "스스로 찾기", "쉽게 묻기", "다시 묻기", "답 제안하기", "짚어주기",
                        "짚어주기(다른 쪽)", "답하기", "내려놓기", "한 일 묻기", "정리하기", "정리하기(다르게)", "끝", "비추기");
    }

    @Test void oldStatusNamesStayReadable() {
        assertThat(List.of(PracticeLoopRouter.OLD_PROBE, PracticeLoopRouter.OLD_CONNECT, PracticeLoopRouter.OLD_GIVE_METHOD,
                PracticeLoopRouter.OLD_CLOSING, PracticeLoopRouter.OLD_ASK_LINE, PracticeLoopRouter.OLD_CLOSE))
                .containsExactly("파고들기", "이어보기", "방법 주기", "마무리", "마무리1", "마무리2");
    }

    @Test void purposeStepAndTaskNamesAreTheStoredText() {
        assertThat(List.of(PurposeLoop.CARD, PurposeLoop.METHOD, PurposeLoop.REASON, PurposeLoop.LINE, PurposeLoop.SEEN,
                PurposeLoop.VIEW, PurposeLoop.CELL, PurposeLoop.CONCERN_STEP, PurposeLoop.NEED, PurposeLoop.HEAR, PurposeLoop.TRY,
                PurposeLoop.WRAP, PurposeLoop.INTENT))
                .containsExactly("card", "method", "reason", "line", "seen", "view", "cell", "concern", "need", "hear", "try", "wrap",
                        "intent");
        assertThat(List.of(PurposeLoop.END, PurposeLoop.ANSWER, PurposeLoop.ACCEPT, PurposeLoop.EASY, PurposeLoop.PROPOSE,
                PurposeLoop.ANOTHER_CARD))
                .containsExactly("end", "answer", "accept", "easy", "propose", "another");
    }
}
