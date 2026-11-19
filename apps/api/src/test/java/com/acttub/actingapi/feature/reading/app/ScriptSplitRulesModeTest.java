package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import com.acttub.actingapi.feature.reading.domain.ScriptSplitMode;
import com.acttub.actingapi.platform.schema.ScriptImportFailure;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * 풀규칙 모드(SOMA-1090, {@code SCRIPT_SPLIT_MODE=rules})를 가짜 대본 묶음으로 본다. 모델에는 배역 성별 묻기 말고 아무것도 보내지 않아야
 * 하고(나누기 첫 판·빠진 줄·띄어쓰기·외국어 없음), 대본은 정답 파일과 같은 줄 90% 이상·배역 목록 일치, 산문은 「대본 아님」이다.
 */
class ScriptSplitRulesModeTest {
    private static final Path FIXTURES = Path.of("src/test/resources/script-split");

    static List<String> fixtures() throws IOException {
        return ScriptSplitRuleFixtureTest.fixtures().toList();
    }

    @org.junit.jupiter.api.Test
    void rulesModeMergesSurnamedAndGivenNamesAndStripsBothHeads() {
        ScriptSplitFakes.Run run = ScriptSplitFakes.run("""
                김민수: 안녕.
                지수: 응.
                민수: 왜 그렇게 봐?
                지수: 그냥.
                민수: 말해 봐.
                김민수: 가자.""", ScriptSplitMode.RULES);

        assertThat(run.saved().characterNames()).containsExactly("민수", "지수");
        assertThat(run.keys(true)).containsExactly(ScriptSplitFakes.key("dialogue", "민수", "안녕."),
                ScriptSplitFakes.key("dialogue", "지수", "응."), ScriptSplitFakes.key("dialogue", "민수", "왜 그렇게 봐?"),
                ScriptSplitFakes.key("dialogue", "지수", "그냥."), ScriptSplitFakes.key("dialogue", "민수", "말해 봐."),
                ScriptSplitFakes.key("dialogue", "민수", "가자."));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("fixtures")
    void rulesModeSplitsWithoutAskingTheModelExceptForCastTraits(String name) throws IOException {
        String raw = Files.readString(FIXTURES.resolve(name + ".txt"));
        List<String> expected = Files.readAllLines(FIXTURES.resolve(name + ".expected.tsv"));
        ScriptSplitFakes.Run run = ScriptSplitFakes.run(raw, ScriptSplitMode.RULES);

        assertThat(run.generator().instructions()).as(name + " 모델 호출").isSubsetOf(List.of(ScriptSplitPrompt.lateTraits()));
        boolean prose = expected.stream().anyMatch(row -> row.startsWith("failure\t"));
        if (prose) {
            assertThat(run.failure()).as(name + " 실패").isEqualTo(ScriptImportFailure.NOT_SCRIPT);
            return;
        }
        assertThat(run.failure()).as(name + " 실패").isNull();
        List<String> want = expected.stream().filter(row -> !row.isBlank() && !row.startsWith("title\t") && !row.startsWith("characters\t"))
                .map(row -> row.split("\t", -1)).map(f -> ScriptSplitFakes.key(f[0], f[1], f[2])).toList();
        List<String> got = run.keys(true);
        int same = ScriptSplitFakes.lcs(want, got);
        int total = Math.max(want.size(), got.size());
        System.out.printf("[rules-mode] %-16s 같은 줄 %3d/%3d (%.1f%%)%n", name, same, total, 100.0 * same / total);
        assertThat((double) same / total).as("%s 같은 줄 %d/%d", name, same, total).isGreaterThanOrEqualTo(0.9);
        String characters = expected.stream().filter(row -> row.startsWith("characters\t")).findFirst().orElseThrow().split("\t")[1];
        assertThat(run.saved().characterNames()).as(name + " 배역").isEqualTo(List.of(characters.split(", ")));
    }
}
