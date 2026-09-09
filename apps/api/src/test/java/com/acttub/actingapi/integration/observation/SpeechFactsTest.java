package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class SpeechFactsTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void bothRecordingsMatchEveryLineOfThePythonReference() throws Exception {
        var recordings = MAPPER.readTree(getClass().getResourceAsStream("/speech/results_tr_raw.json"));
        for (String id : (Iterable<String>) recordings::fieldNames) {
            var recording = recordings.get(id);
            List<SpeechFacts.Word> words = new ArrayList<>();
            for (var word : recording.path("words")) {
                words.add(new SpeechFacts.Word(word.path("word").asText(),
                        seconds(word.path("start_offset").asText()),
                        seconds(word.path("end_offset").asText())));
            }
            SpeechAnalysis result = SpeechFacts.calculate(recording.path("text").asText(), words);
            String expected;
            try (var input = getClass().getResourceAsStream("/speech/" + id + ".txt")) {
                expected = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            }
            assertThat(render(result, words)).as(id).isEqualTo(expected);
            assertThat(result.transcript()).isEqualTo(recording.path("text").asText());
            assertThat(result.pauses()).hasSize(8);
            if (id.startsWith("0d965ac7")) {
                assertThat(words).hasSize(136);
                assertThat(SpeechFacts.pauses(words)).hasSize(35);
                assertThat(result.chunks()).hasSize(17);
                assertThat(result.avgSyllablesPerSec()).isEqualTo(7.0);
            }
        }
    }

    @Test
    void countsHangulSyllablesOrUnicodeCodePoints() {
        assertThat(SpeechFacts.syllables("한글!abc")).isEqualTo(2);
        assertThat(SpeechFacts.syllables("abc!😀")).isEqualTo(5);
        assertThat(SpeechFacts.syllables("")).isZero();
    }

    @Test
    void halfSecondIsAPauseAndTwoSecondsIsNotAShortChunk() {
        var words = List.of(word("가", 0, 2), word("나", 2.5, 4.5), word("다", 4.999, 7));
        var result = SpeechFacts.calculate("가 나 다", words);
        assertThat(result.pauses()).hasSize(1);
        assertThat(result.pauses().getFirst().seconds()).isEqualTo(0.5);
        assertThat(result.chunks()).extracting(SpeechAnalysis.Chunk::text)
                .containsExactly("가", "나 다");
    }

    @Test
    void shortChunkMergesWithCloserNeighborAndPrefersPreviousOnATie() {
        var tie = SpeechFacts.calculate("", List.of(
                word("가", 0, 2), word("나", 3, 4), word("다", 5, 7)));
        assertThat(tie.chunks()).extracting(SpeechAnalysis.Chunk::text).containsExactly("가 나", "다");
        var next = SpeechFacts.calculate("", List.of(
                word("가", 0, 2), word("나", 4, 5), word("다", 6, 8)));
        assertThat(next.chunks()).extracting(SpeechAnalysis.Chunk::text).containsExactly("가", "나 다");
        var repeat = SpeechFacts.calculate("", List.of(
                word("가", 0, .5), word("나", 1, 1.5), word("다", 2, 2.5)));
        assertThat(repeat.chunks()).extracting(SpeechAnalysis.Chunk::text).containsExactly("가 나 다");
    }

    @Test
    void averageUsesTotalSpokenTimeAndExcludesSilenceInsideMergedChunks() {
        var result = SpeechFacts.calculate("", List.of(
                word("가나다라", 0, .5), word("가나다라", 1, 1.5), word("가나", 3, 5)));
        assertThat(result.avgSyllablesPerSec()).isEqualTo(3.3); // 10 / 3
        assertThat(result.chunks()).singleElement().satisfies(c -> {
            assertThat(c.rate()).isEqualTo(3.3);
            assertThat(c.deltaPct()).isZero();
        });
    }

    @Test
    void emptyOrVeryShortSpeechDoesNotInventARate() {
        assertThat(SpeechFacts.calculate("", List.of()))
                .isEqualTo(new SpeechAnalysis("", 0, List.of(), List.of()));
        for (double end : List.of(0.0, 0.4)) {
            var result = SpeechFacts.calculate("아", List.of(word("아", 0, end)));
            assertThat(result.chunks()).singleElement().satisfies(c -> {
                assertThat(c.rate()).isNull();
                assertThat(c.deltaPct()).isNull();
                assertThat(c.mark()).isNull();
            });
        }
        assertThat(SpeechFacts.calculate("아", List.of(word("아", 0, .401))))
                .extracting(r -> r.chunks().getFirst().rate()).isNotNull();
    }

    @Test
    void markUsesUnroundedDeltaAndStrictTwelvePercentThresholds() {
        var boundary = SpeechFacts.calculate("", List.of(
                word("가".repeat(28), 0, 2), word("나".repeat(22), 3, 5)));
        assertThat(boundary.chunks()).extracting(SpeechAnalysis.Chunk::mark)
                .containsExactly("보통", "보통");
        var outside = SpeechFacts.calculate("", List.of(
                word("가".repeat(1121), 0, 2), word("나".repeat(879), 3, 5)));
        assertThat(outside.chunks()).extracting(SpeechAnalysis.Chunk::deltaPct).containsExactly(12, -12);
        assertThat(outside.chunks()).extracting(SpeechAnalysis.Chunk::mark).containsExactly("빠름", "느림");
    }

    private static String render(SpeechAnalysis result, List<SpeechFacts.Word> words) {
        StringBuilder out = new StringBuilder(String.format(Locale.ROOT,
                "- 전체 길이 %s · 발화 단어 %d개 · 평균 말 속도 초당 %.1f음절%n",
                mmss(Math.round(words.getLast().end() * 1000)), words.size(), result.avgSyllablesPerSec()));
        out.append("- 사이(0.5초 이상 침묵) ").append(SpeechFacts.pauses(words).size()).append("번:\n");
        for (var pause : result.pauses()) {
            out.append(String.format(Locale.ROOT, "    %s 에 %.1f초 — “…%s” 뒤, “%s…” 앞%n",
                    mmss(pause.atMs()), pause.seconds(), pause.after(), pause.before()));
        }
        out.append("- 대사 덩어리별 말 속도(").append(result.chunks().size())
                .append("개, 초당 음절, 평균 대비):\n");
        for (var chunk : result.chunks()) {
            if (chunk.rate() == null) continue;
            out.append(String.format(Locale.ROOT, "    %s~%s  %4.1f  %+5d%%  %s  “%s”%n",
                    mmss(chunk.startMs()), mmss(chunk.endMs()), chunk.rate(), chunk.deltaPct(),
                    chunk.mark(), chunk.text()));
        }
        return out.toString();
    }

    private static String mmss(long ms) {
        return String.format(Locale.ROOT, "%d:%02d", ms / 60000, ms / 1000 % 60);
    }

    private static double seconds(String offset) {
        return offset.equals("null") ? 0 : Double.parseDouble(offset.replaceFirst("s$", ""));
    }

    private static SpeechFacts.Word word(String text, double start, double end) {
        return new SpeechFacts.Word(text, start, end);
    }
}
