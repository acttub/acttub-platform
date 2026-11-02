package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import com.acttub.actingapi.platform.observability.LlmPrompt;
import com.acttub.actingapi.platform.observability.LlmStep;
import org.junit.jupiter.api.Test;

/** 기록에 잇는 템플릿은 호출마다 같아야 한다. 배역 이름이 들어가면 버전이 끝없이 늘고 사용자 글이 프롬프트 저장소에 남는다. */
class ScriptSplitPromptTemplateTest {
    private static final List<String> CAST = List.of("김비밀배역", "박$비밀\\배역");

    private static LlmPrompt split(String instructions) {
        return ScriptSplitPrompt.template(LlmStep.SCRIPT_SPLIT, instructions);
    }

    @Test
    void knownCastLeavesNoNameAndDoesNotChangeTheTemplate() {
        for (var build : List.<java.util.function.Function<List<String>, String>>of(
                roster -> ScriptSplitPrompt.split(false, roster),
                ScriptSplitPrompt::missing,
                roster -> ScriptSplitPrompt.unnamed(ScriptSplitPrompt.split(false, roster)),
                roster -> ScriptSplitPrompt.formatRetry(ScriptSplitPrompt.missing(roster)))) {
            LlmPrompt one = split(build.apply(CAST));
            LlmPrompt other = split(build.apply(List.of("이다른사람")));
            assertThat(one).isEqualTo(other);
            assertThat(one.text()).contains("{배역}").doesNotContain("비밀", "이다른사람");
        }
    }

    @Test
    void everyBranchHasItsOwnNameAndOneBody() {
        List<String> branches = List.of(
                ScriptSplitPrompt.split(true, List.of(), true),
                ScriptSplitPrompt.split(false, List.of(), true),
                ScriptSplitPrompt.split(false, CAST),
                ScriptSplitPrompt.missing(List.of()),
                ScriptSplitPrompt.missing(CAST),
                ScriptSplitPrompt.roster(true),
                ScriptSplitPrompt.roster(false));
        List<String> all = branches.stream().flatMap(text -> Stream.of(text, ScriptSplitPrompt.unnamed(text),
                ScriptSplitPrompt.formatRetry(text), ScriptSplitPrompt.formatRetry(ScriptSplitPrompt.unnamed(text)))).distinct().toList();
        Set<LlmPrompt> templates = all.stream().map(ScriptSplitPromptTemplateTest::split).collect(Collectors.toSet());
        assertThat(templates.stream().map(LlmPrompt::name).distinct()).hasSameSizeAs(templates);
        assertThat(split(ScriptSplitPrompt.split(true, List.of(), true)).name()).isEqualTo("script.split.rows.judge.traits");
        assertThat(split(ScriptSplitPrompt.formatRetry(ScriptSplitPrompt.unnamed(ScriptSplitPrompt.missing(CAST)))).name())
                .isEqualTo("script.split.missing.known-cast.unnamed.format-retry");
    }

    @Test
    void theOtherStepsKeepTheirFixedInstructions() {
        assertThat(ScriptSplitPrompt.template(LlmStep.SCRIPT_SPACING, ScriptSplitPrompt.spacing()))
                .isEqualTo(new LlmPrompt("script.spacing", ScriptSplitPrompt.spacing()));
        assertThat(ScriptSplitPrompt.template(LlmStep.SCRIPT_LANGUAGE, ScriptSplitPrompt.language()))
                .isEqualTo(new LlmPrompt("script.language", ScriptSplitPrompt.language()));
        assertThat(ScriptSplitPrompt.template(LlmStep.SCRIPT_CAST, ScriptSplitPrompt.lateTraits()))
                .isEqualTo(new LlmPrompt("script.cast", ScriptSplitPrompt.lateTraits()));
    }
}
