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

    @org.junit.jupiter.api.Test
    void rulesModeJoinsLinesCutAtThePageWidth() {
        StringBuilder raw = new StringBuilder();
        for (int k = 0; k < 10; k++) {
            raw.append("민수 오늘은 무대가 아주 넓어 보이고 조명도 밝아서 무언가를 시작하\n");
            raw.append("고 싶은 마음이 들어.\n");
            raw.append("영희 그럼 같이 시작해 보자.\n");
        }
        ScriptSplitFakes.Run pdf = ScriptSplitFakes.run(raw.toString(), ScriptSplitMode.RULES, "play.pdf");
        ScriptSplitFakes.Run pasted = ScriptSplitFakes.run(raw.toString(), ScriptSplitMode.RULES, null);

        // 화면 폭에서 잘린 줄은 파일 종류와 상관없이 잇는다 — 「시작하」+「고 싶은…」은 띄어쓰기 없이 붙는다
        for (ScriptSplitFakes.Run run : List.of(pdf, pasted)) {
            assertThat(run.saved().characterNames()).containsExactly("민수", "영희");
            assertThat(run.saved().lines()).anyMatch(line -> line.text().contains("시작하고 싶은 마음이 들어."));
        }
    }

    @org.junit.jupiter.api.Test
    void rulesModeKeepsShortLinesThatAreNotCut() {
        StringBuilder raw = new StringBuilder();
        for (int k = 0; k < 10; k++) {
            raw.append("민수 오늘은 무대가 넓어 보이는데\n");
            raw.append("영희 그럼 같이 시작해 보자\n");
        }
        ScriptSplitFakes.Run run = ScriptSplitFakes.run(raw.toString(), ScriptSplitMode.RULES, "play.txt");

        // 끝 부호 없이 짧게 쓴 줄이 번갈아 와도 다음 줄이 배역 머리라 잇지 않는다
        assertThat(run.saved().lines()).hasSize(20);
    }

    @org.junit.jupiter.api.Test
    void rulesModeTagsForeignLinesWithoutAskingTheModel() {
        ScriptSplitFakes.Run run = ScriptSplitFakes.run("민수: 안녕.\n영희: I never left you.\n민수: 고맙습니다. Thank you so much.\n영희: 그래.",
                ScriptSplitMode.RULES, null);

        assertThat(run.generator().instructions()).isSubsetOf(List.of(ScriptSplitPrompt.lateTraits()));
        assertThat(run.saved().lines()).filteredOn(line -> line.lang() != null)
                .extracting(line -> line.lang() + "|" + line.speech())
                .containsExactly("en|null", "en|⟦ko⟧고맙습니다. ⟦en⟧Thank you so much.");
    }

    @org.junit.jupiter.api.Test
    void rulesModeSplitsTurnsWrittenOnOneLine() {
        StringBuilder raw = new StringBuilder();
        for (int k = 0; k < 5; k++) {
            raw.append("에이코 뭐고, 준코 너 그거 봤나?  준코 띄엄띄엄 봤다.  키요코 재밌다 아이가.\n\n");
            raw.append("준코 그래?\n\n키요코 나는 몰라.\n\n에이코 몰라도 된다.\n\n");
        }
        ScriptSplitFakes.Run run = ScriptSplitFakes.run(raw.toString(), ScriptSplitMode.RULES, null);

        assertThat(run.saved().characterNames()).containsExactlyInAnyOrder("에이코", "준코", "키요코");
        assertThat(run.keys(true)).contains(ScriptSplitFakes.key("dialogue", "키요코", "재밌다 아이가."));
    }

    @org.junit.jupiter.api.Test
    void rulesModeTakesTheMonologueSpeakerFromTheTitle() {
        ScriptSplitFakes.Run run = ScriptSplitFakes.runTitled("사느냐 죽느냐, 그것이 문제로다.\n\n가혹한 운명의 화살을 견디는 것이 고귀한가.", ScriptSplitMode.RULES,
                "햄릿 독백");

        assertThat(run.saved().characterNames()).containsExactly("햄릿");
    }

    @org.junit.jupiter.api.Test
    void rulesModeTurnsWordTabsIntoSpaces() {
        StringBuilder raw = new StringBuilder();
        for (int k = 0; k < 4; k++) {
            raw.append("유현\t \t 오늘은\t어디\t가?\n미유키\t \t 그냥\t집에\t있을래.\n꾸밈없는\t얼굴로\t미유키가\t웃는다.\n");
        }
        ScriptSplitFakes.Run run = ScriptSplitFakes.run(raw.toString(), ScriptSplitMode.RULES, "play.pdf");

        assertThat(run.saved().characterNames()).containsExactly("유현", "미유키");
        assertThat(run.saved().lines()).noneMatch(line -> line.text().contains("\t"));
        assertThat(run.keys(true)).contains(ScriptSplitFakes.key("dialogue", "유현", "오늘은 어디 가?"));
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
