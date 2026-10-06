package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.observation.DirectVideoModel;

class DirectVideoDialogueEvidenceTest {
    private final DirectVideoModel.Video silent = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4", false);

    @Test void onlyVerifiedMissingAudioOverridesTheInstruction() {
        assertThat(DirectVideoPrompts.withAudioFacts("task", silent)).startsWith("[Server-verified original video metadata]")
                .contains("audio_track_present=false", "대사 확인: 확인 안 됨", "확인된 대사: 없음").endsWith("task");
        assertThat(DirectVideoPrompts.withAudioFacts("task", new DirectVideoModel.Video("file", "uri", "video/mp4", true)))
                .isEqualTo("task");
        assertThat(DirectVideoPrompts.withAudioFacts("task", new DirectVideoModel.Video("file", "uri", "video/mp4")))
                .isEqualTo("task");
    }

    @Test void silentReplyCannotClaimAudioOnlyOrMixedObservationSources() {
        for (String source : List.of("음성만", "화면·음성", "음성만: 감정이 들린다")) {
            assertThatThrownBy(() -> DirectVideoDialogueEvidence.requireGrounded(silent,
                    "<설계>관찰 근거: " + source + "\n대사 확인: 확인 안 됨\n확인된 대사: 없음</설계>"
                            + "<코치>애원하는 감정이 들려요.</코치>", ""))
                    .isInstanceOf(IllegalStateException.class);
        }
        DirectVideoDialogueEvidence.requireGrounded(silent,
                "<설계>관찰 근거: [\"화면만\"]\n대사 확인: 확인 안 됨\n확인된 대사: 없음</설계>"
                        + "<코치>손동작이 보여요.</코치>", "");
    }

    @Test void silentReplyCannotClaimConfirmedSpeech() {
        assertThatThrownBy(() -> DirectVideoDialogueEvidence.requireGrounded(silent,
                "<설계>대사 확인: [확인됨]\n확인된 대사: [없음]</설계><코치>보이는 손동작이에요.</코치>", ""))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test void silentReplyCannotStoreDialogueInTheBodyOrHiddenNoteEvidence() {
        String design = "<설계>대사 확인: 확인 안 됨\n확인된 대사: 없음</설계>";
        assertThatThrownBy(() -> DirectVideoDialogueEvidence.requireGrounded(silent,
                design + "<코치>\"왜요\"라고 할 때 고개를 들어요.</코치>", ""))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> DirectVideoDialogueEvidence.requireGrounded(silent,
                "<설계>대사 확인: 확인 안 됨\n확인된 대사: 없음\n버릇: \"왜요\" 전에 눈을 깜빡여요.</설계>"
                        + "<코치>눈을 깜빡이는 편인가요?</코치>", ""))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test void actualActorWritingCanBeRepeatedButNeverBecomeConfirmedSpeech() {
        String written = "나는 \"멈춤\"을 피하는 배우다";
        DirectVideoDialogueEvidence.requireGrounded(silent,
                "<상태>대사 확인: 확인 안 됨\n할 일: 마무리2</상태>" + written + "라고 적어 둘게요.", written);
        DirectVideoDialogueEvidence.requireGrounded(silent,
                "<설계>대사 확인: [\"확인 안 됨\"]\n확인된 대사: [\"없음\"]</설계><코치>손동작이 보여요.</코치>", "");
        assertThatThrownBy(() -> DirectVideoDialogueEvidence.requireGrounded(silent,
                "<설계>대사 확인: 확인 안 됨\n확인된 대사: [\"멈춤\"]</설계><코치>손동작이 보여요.</코치>", written))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test void olderInventedDialogueIsNotReplayedOrReusedForNewNotes() {
        var state = CoachingStateReducer.empty();
        var loop = state.putObject("practice_loop");
        loop.put("design", "버릇: \"왜요\" 전에 고개를 들어요");
        loop.putArray("statuses").add("응답 2번째");
        DirectVideoDialogueEvidence.discardUngroundedDesign(silent, state, "");
        assertThat(loop.path("design").isMissingNode()).isTrue();
        assertThat(loop.path("statuses").size()).isEqualTo(1);
        loop.put("design", "대사 확인: 확인 안 됨\n확인된 대사: 없음\n버릇: 손을 펴요");
        DirectVideoDialogueEvidence.discardUngroundedDesign(silent, state, "");
        assertThat(loop.path("design").asText()).contains("버릇: 손을 펴요");
    }

    @Test void bothLoopPromptsCheckSpeechBeforeChoosingVisibleEvidence() {
        for (String prompt : List.of(DirectVideoPrompts.practiceLoop(), DirectVideoPrompts.practiceLoopEnglish(),
                DirectVideoPrompts.practiceLoop(UUID.randomUUID()))) {
            assertThat(prompt).contains("대사 확인:", "확인된 대사:", "확인됨", "확인 안 됨")
                    .doesNotContain("그 대사 두 곳", "| 곳1: \"대사\"", "| 곳1: \"line\"", "with two lines from the video");
            assertThat(prompt.indexOf("\n대사 확인:")).isLessThan(prompt.indexOf("\n감정의 변화:"));
        }
        assertThat(DirectVideoPrompts.practiceLoop()).contains("입모양 받아쓰기", "무언 연기", "표정·시선·몸·움직임");
        assertThat(DirectVideoPrompts.practiceLoopEnglish()).contains("Do not quote dialogue, lip-read", "Silent acting");
    }

    @Test void classifierOpeningUsesTheSameUnconfirmedAudioConstraint() {
        assertThat(DirectVideoPrompts.forRoutes(List.of(DirectVideoRoute.OPENING)))
                .contains("음성이 없거나 알아듣기 어렵거나 확신할 수 없으면", "작성한 글로만 다루며", "무언 연기는")
                .contains("음성이 없거나 불명확하면 보이는 구간만 쓰고 입모양으로 대사를 채우지 마라");
    }

    @Test void unconfirmedSpeechIsHiddenFromTheActorAndReplayedIntoLaterHistory() {
        var state = CoachingStateReducer.empty();
        var first = DirectVideoPracticeLoop.parse("""
                <설계>
                영상: 연기
                대사 확인: 확인 안 됨
                확인된 대사: 없음
                버릇: 손을 펴며 고개를 돌려요
                </설계>
                <코치>
                손을 펼 때마다 고개를 돌리는 쪽으로 가요.
                인물의 선택일 수도 있어요.
                평소에도 그런 편인가요?
                </코치>
                """);
        DirectVideoPracticeLoop.remember(state, first);
        var second = DirectVideoPracticeLoop.parse("""
                <상태>
                대사 확인: 확인 안 됨
                할 일: 짚어주기
                </상태>
                손을 펴는 동작이 분명하게 보여요.
                고개를 돌릴 때 표정이 덜 보여요.
                이 두 가지를 어떻게 생각하나요?
                """);
        DirectVideoPracticeLoop.remember(state, second);
        var history = DirectVideoPracticeLoop.history(List.of(
                new CoachTurnSnapshot("ai", first.message()),
                new CoachTurnSnapshot("actor", "장점도 설명해 주세요"),
                new CoachTurnSnapshot("ai", second.message())), state, "왜 그렇게 보이나요?");
        assertThat(first.message()).doesNotContain("대사 확인", "확인된 대사");
        assertThat(second.message()).doesNotContain("대사 확인");
        assertThat(history.getFirst().text()).contains("대사 확인: 확인 안 됨", "확인된 대사: 없음");
        assertThat(history.get(2).text()).contains("<상태>대사 확인: 확인 안 됨", "할 일: 짚어주기");
        assertThat(DirectVideoPracticeLoop.finished(second)).isFalse();
    }
}
