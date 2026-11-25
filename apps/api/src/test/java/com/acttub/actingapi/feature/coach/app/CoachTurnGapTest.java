package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

/**
 * 코칭 한 차례에서 지금 동작을 잡는 시험이 없던 곳(SOMA-1092 16번 조사의 「빈 곳」, SOMA-1133 묶음). 코드를 나누기 전에 지금 동작을 적어 둔다.
 * <ul>
 *   <li>말로 하는 코칭의 화면 글 후처리: 배우가 적지 않은 따옴표 대사 떼기, 결과 장담 떼기, 정리 뒤 답의 물음 떼기.</li>
 *   <li>같은 단계에 머물 때 재료에 붙는 "앞 판단을 되풀이하지 않는다" 문장(#808). 짚어주기·답하기에만 붙는다.</li>
 *   <li>목적별 코칭의 이어하기: 다시 연 뒤에는 그때부터 응답 수를 센다.</li>
 * </ul>
 */
class CoachTurnGapTest {
    static final String REPEAT_RULE = "앞에서 한 판단·대사·제안 문장을 그대로 되풀이하지 않는다.";

    @Test void talkTurnsDropQuotesTheActorNeverWroteAndPromisesButKeepTheQuestion() {
        var rig = new CoachTurnGoldenRig();
        rig.model.says(CoachTurnGoldenTest.TALK_OPENING,
                "\"사랑해\"라고 해 봐요. 그러면 훨씬 잘 느껴질 거예요. 어떤 방법이 좋을까요?\n<보기>\n- 끝을 짧게 끊기\n</보기>");
        rig.model.classifies(CoachTurnGoldenTest.signals("answered"));
        var opened = rig.turn(CoachTurnGoldenRig.fresh("", 0, null, PurposeLoop.TALK_PREFIX + "stuck"), null).session();
        var result = rig.turn(opened, "감정이 안 따라와요");
        rig.close();
        assertThat(result.reply().message()).isEqualTo("어떤 방법이 좋을까요?");
    }

    @Test void aTalkAnswerAfterTheWrapAlsoLosesItsQuestions() {
        var rig = new CoachTurnGoldenRig();
        CoachTurnGoldenTest.talkStuck(rig);
        rig.close();
        String last = rig.out.substring(rig.out.lastIndexOf("## 차례 4"), rig.out.lastIndexOf("# 그만(말로)"));
        // 모델은 "\"사랑해\"라고 읽어 보면 돼요. 소리 내어 읽으면 입에 붙어요. 그러면 훨씬 자연스러워질 거예요. 다시 해 볼까요?"라고 썼다.
        assertThat(last).contains("route=purpose:talk:stuck:answer").contains("코치 말:\n  |소리 내어 읽으면 입에 붙어요.\n저장 상태:");
    }

    @Test void theRepeatRuleIsAddedOnlyWhenPointingOutOrAnsweringInTheSameStep() {
        var rig = new CoachTurnGoldenRig();
        rig.model.says(CoachTurnGoldenTest.OPENING);
        var opened = rig.turn(CoachTurnGoldenRig.fresh(), null).session();
        assertThat(instruction(rig, opened, "연기력은 어때?", "not_yet", "evaluation"))
                .contains("할 일: 짚어주기")
                .contains("이 단계에서 이번이 2번째 응답이다").contains(REPEAT_RULE);
        assertThat(instruction(rig, opened, "왜 그렇게 봤어요?", "not_yet", "question"))
                .contains("할 일: 답하기").contains(REPEAT_RULE);
        assertThat(instruction(rig, opened, "그건 다른 장면이에요", "not_yet", "correction"))
                .contains("할 일: 내려놓기")
                .contains("이 단계에서 이번이 2번째 응답이다").doesNotContain(REPEAT_RULE);
        assertThat(instruction(rig, opened, "붙잡고 싶었어요", "answered"))
                .contains("할 일: 어긋남 보기")
                .contains("코치가 앞에서 이미 한 질문(같은 뜻으로 다시 묻지 않는다.")
                .doesNotContain("번째 응답이다").doesNotContain(REPEAT_RULE);
        rig.close();
    }

    /** 이번 차례에 모델로 나간 지시문과 저장된 할 일. */
    private static String instruction(CoachTurnGoldenRig rig, CoachSessionSnapshot session, String actorText, String... signals) {
        rig.model.classifies(CoachTurnGoldenTest.signals(signals)).says("그 장면에서 누구를 봤어요?");
        var result = rig.turn(session, actorText);
        String said = rig.calls.stream().filter(call -> call.text().startsWith("reply ")).reduce((a, b) -> b).orElseThrow().instruction();
        var statuses = result.session().coachingState().path(DirectVideoPracticeLoop.STATE_KEY).path("statuses");
        return said + "\n" + statuses.get(statuses.size() - 1).asString();
    }

    @Test void aResumedPurposeConversationCountsRepliesFromTheResume() {
        var answered = PurposeLoopTest.ANSWERED;
        var purpose = PurposeLoop.Purpose.STUCK;
        // 다시 열지 않은 대화: 코치 응답 8개 뒤의 답은 상한을 채우는 정리다.
        var closedAtCap = PurposeLoop.decide(purpose, PurposeLoopTest.state("{\"step\":0}"), "막혔어요", null, answered, 8);
        assertThat(closedAtCap.doing()).isEqualTo("wrap");
        // 응답 8개에서 다시 열었으면 그때부터 센다 — 다음 단계로 간다.
        var resumed = PurposeLoop.decide(purpose, PurposeLoopTest.state("{\"step\":0,\"resumed_at\":8}"), "막혔어요", null, answered, 8);
        assertThat(resumed.doing()).isEqualTo("line");
        assertThat(resumed.step()).isEqualTo("line");
        // 다시 연 뒤에도 응답이 8개 더 쌓이면 정리다.
        var resumedCap = PurposeLoop.decide(purpose, PurposeLoopTest.state("{\"step\":0,\"resumed_at\":1}"), "막혔어요", null, answered, 9);
        assertThat(resumedCap.doing()).isEqualTo("wrap");
        assertThat(PurposeLoop.resumedAt(PurposeLoopTest.state("{\"resumed_at\":3}").path(PurposeLoop.STATE_KEY))).isEqualTo(3);
        assertThat(PurposeLoop.resumedAt(PurposeLoopTest.state("{}").path(PurposeLoop.STATE_KEY))).isEqualTo(-1);
        assertThat(List.of(closedAtCap.end(), resumed.end(), resumedCap.end())).containsOnly(false);
    }
}
