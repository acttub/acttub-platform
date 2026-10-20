package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.platform.web.OutputLanguage;
import org.junit.jupiter.api.Test;

/** 영상 직접 코치 프롬프트 조각: 한국어 Locale 은 기본(null)과 같은 글을, 그 밖의 말은 그 말의 글을 고른다. */
class DirectVideoPromptsLanguageTest {
    @Test void anExplicitKoreanLocaleReadsTheSamePromptsAsTheDefault() {
        UUID practice = UUID.fromString("00000000-0000-0000-0000-000000000007");
        assertThat(DirectVideoPrompts.practiceLoop(practice, Locale.KOREAN)).isEqualTo(DirectVideoPrompts.practiceLoop(practice));
        assertThat(DirectVideoPrompts.practiceLoopTurn(Locale.KOREAN)).isEqualTo(DirectVideoPrompts.practiceLoopTurn());
        assertThat(DirectVideoPrompts.practiceLoopShorten(Locale.KOREAN)).isEqualTo(DirectVideoPrompts.practiceLoopShorten(null));
        assertThat(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.GAP, Locale.KOREAN, CoachFlows.B))
                .isEqualTo(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.GAP, null, CoachFlows.B));
        assertThat(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.WANT, Locale.KOREAN))
                .isEqualTo(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.WANT, null));
        assertThat(DirectVideoPrompts.persona("b1", Locale.KOREAN)).isEqualTo(DirectVideoPrompts.persona("b1", null));
    }

    @Test void otherLanguagesGetTheirOwnTextOrALanguageDirective() {
        assertThat(DirectVideoPrompts.practiceLoopShorten(Locale.JAPANESE))
                .isEqualTo(DirectVideoPrompts.practiceLoopShorten(null) + OutputLanguage.directiveFor(Locale.JAPANESE));
        assertThat(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.GAP, Locale.ENGLISH, CoachFlows.B))
                .isNotEqualTo(DirectVideoPrompts.practiceLoopTask(PracticeLoopRouter.GAP, null, CoachFlows.B));
        assertThat(DirectVideoPrompts.flowBlock(CoachFlows.B, Locale.KOREAN)).startsWith("\n\n").hasSizeGreaterThan(10);
        assertThat(DirectVideoPrompts.flowBlock(CoachFlows.B, Locale.ENGLISH)).isEmpty();
        assertThat(DirectVideoPrompts.flowBlock(CoachFlows.A, null)).isEmpty();
    }

    @Test void theRootPathIsPickedByNumberOrNameAndUnknownValuesGetNothing() {
        assertThat(DirectVideoPrompts.practiceLoopRoot(null, null)).isEmpty();
        assertThat(DirectVideoPrompts.practiceLoopRoot(" ", null)).isEmpty();
        assertThat(DirectVideoPrompts.practiceLoopRoot("9 모름", null)).isEmpty();
        assertThat(DirectVideoPrompts.practiceLoopRoot("2", Locale.KOREAN)).isEqualTo(DirectVideoPrompts.practiceLoopRoot("목적이 흐림", null))
                .isNotEmpty();
        assertThat(DirectVideoPrompts.practiceLoopRoot("관계", Locale.ENGLISH)).isNotEqualTo(DirectVideoPrompts.practiceLoopRoot("관계", null));
    }

    @Test void theContinuationBlockNeedsAnEarlierConversation() {
        assertThat(DirectVideoPrompts.continuation(null, null)).isEmpty();
        assertThat(DirectVideoPrompts.continuation(new PriorContext(Map.of(), " ", true, List.of(), List.of()), null)).isEmpty();
        String withoutSummary = DirectVideoPrompts.continuation(
                new PriorContext(Map.of(), "배우: 다시 해 볼게", true, List.of(), List.of()), Locale.KOREAN);
        assertThat(withoutSummary).doesNotContain("### 지난 회차 요약").endsWith("### 지난 회차 마지막 대화\n배우: 다시 해 볼게");
    }

    @Test void unknownTasksAndPersonasAreHandledExplicitly() {
        assertThatThrownBy(() -> DirectVideoPrompts.practiceLoopTask("없는 일", null)).hasMessage("practice loop task is missing: 없는 일");
        assertThat(DirectVideoPrompts.persona(" ", null)).isEmpty();
        assertThat(DirectVideoPrompts.persona(CoachPersonas.DEFAULT, null)).isEmpty();
        assertThat(DirectVideoPrompts.persona("b1", Locale.ENGLISH)).isEmpty();
        assertThat(DirectVideoPrompts.personaShortenNote("b1", null)).isEqualTo(
                "\n- 말투는 원래 말의 말투를 그대로 둔다. 원래 말이 \"~해요.\"로 방향을 줬으면 \"~해 봐도 좋아요\"로 바꾸지 않는다. 쿠션어나 칭찬을 더하지 않는다.");
        assertThat(DirectVideoPrompts.withAudioFacts("지시", new DirectVideoModel.Video("f", "u", "video/mp4", true))).isEqualTo("지시");
        assertThat(DirectVideoPrompts.withAudioFacts("지시", null)).isEqualTo("지시");
        assertThat(DirectVideoPrompts.withAudioFacts("지시", new DirectVideoModel.Video("f", "u", "video/mp4", false)))
                .endsWith("\n\n지시").isNotEqualTo("지시");
    }
}
