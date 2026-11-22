package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import com.acttub.actingapi.feature.reading.domain.NumberedLine;
import com.acttub.actingapi.feature.reading.domain.RuleSplit;
import com.acttub.actingapi.feature.reading.domain.ScriptSplitMode;
import com.acttub.actingapi.platform.schema.ScriptImportFailure;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/**
 * 규칙 나누기(SOMA-1090)를 가짜 대본 묶음({@code src/test/resources/script-split/})으로 본다. 워커를 {@link ScriptSplitMode#HYBRID}
 * 로 돌리되 모델 자리에는 빈 답만 하는 가짜를 넣는다 — 규칙이 답하지 못한 줄은 모델이 채우지 못하고 빠진다. 그러니 이 시험의
 * 일치율은 「규칙만으로」의 하한이다. 기준은 실제 모델 시험({@link ScriptSplitLiveTest})과 같다: 묶음마다 같은 줄 90% 이상, 배역 목록 일치.
 *
 * <p>규칙이 확신한 묶음은 나누기 첫 판 호출을 하나도 보내지 않아야 한다. 산문(대본 아님)은 규칙이 확신하지 않아야 한다 — 그러면
 * 모델이 대본 여부를 판단한다.
 */
class ScriptSplitRuleFixtureTest {
    private static final Path FIXTURES = Path.of("src/test/resources/script-split");

    static Stream<String> fixtures() throws IOException {
        try (Stream<Path> files = Files.list(FIXTURES)) {
            return files.map(Path::getFileName).map(Path::toString).filter(name -> name.endsWith(".txt"))
                    .map(name -> name.substring(0, name.length() - 4)).sorted().toList().stream();
        }
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("fixtures")
    void rulesAloneSplitTheFixtureLikeTheExpectedFile(String name) throws IOException {
        String raw = Files.readString(FIXTURES.resolve(name + ".txt"));
        Expected expected = Expected.read(FIXTURES.resolve(name + ".expected.tsv"));
        RuleSplit.Result rule = RuleSplit.of(NumberedLine.of(raw));

        if (expected.failure != null) {
            // 대본이 아닌 글은 규칙이 확신하지 않는다 — 모델이 판단하게 넘긴다
            assertThat(rule.confident()).as(name + " 규칙 확신").isFalse();
            return;
        }
        assertThat(rule.confident()).as("%s 규칙 확신(답한 줄 %d/%d, 대사 %d)", name, rule.rows().size(), rule.total(), rule.dialogues())
                .isTrue();

        ScriptSplitFakes.Run run = ScriptSplitFakes.run(raw);

        assertThat(run.generator().firstPassCalls()).as(name + " 나누기 첫 판 호출").isZero();
        assertThat(run.failure()).as(name + " 실패").isNull();
        assertThat(run.saved()).as(name + " 저장").isNotNull();
        List<String> got = run.keys(true);
        int same = ScriptSplitFakes.lcs(expected.lines, got);
        int total = Math.max(expected.lines.size(), got.size());
        System.out.printf("[rule-split] %-16s 같은 줄 %3d/%3d (%.1f%%) · 규칙 답 %d/%d줄 · 빠진 줄 호출 %d · 형식 %s%n", name, same, total,
                100.0 * same / total, rule.rows().size(), rule.total(), run.generator().missingCalls(), rule.format());
        assertThat((double) same / total).as("%s 같은 줄 %d/%d", name, same, total).isGreaterThanOrEqualTo(0.9);
        assertThat(run.saved().characterNames()).as(name + " 배역").isEqualTo(expected.characters);
    }

    private record Expected(List<String> characters, List<String> lines, ScriptImportFailure failure) {
        static Expected read(Path path) throws IOException {
            List<String> characters = List.of();
            List<String> lines = new ArrayList<>();
            ScriptImportFailure failure = null;
            for (String row : Files.readAllLines(path)) {
                if (row.isBlank()) continue;
                String[] fields = row.split("\t", -1);
                switch (fields[0]) {
                    case "title" -> { }
                    case "characters" -> characters = List.of(fields[1].split(", "));
                    case "failure" -> failure = ScriptImportFailure.valueOf(fields[1].toUpperCase());
                    default -> lines.add(ScriptSplitFakes.key(fields[0], fields[1], fields[2]));
                }
            }
            return new Expected(characters, lines, failure);
        }
    }
}
