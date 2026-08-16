package com.acttub.actingapi.analysis;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import com.acttub.actingapi.integration.observation.ObservationPack;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class SummaryAnalyzerTest {

    @TempDir
    Path temporary;

    @Test
    void resolvesDurationThenCompressesObservesAndOnlyThenTranscribes() throws Exception {
        Path video = Files.writeString(temporary.resolve("take.mp4"), "video");
        Path compressed = Files.writeString(temporary.resolve("take.gemini.mp4"), "small");
        Path audioDirectory = Files.createDirectory(temporary.resolve("audio"));
        Path audio = Files.writeString(audioDirectory.resolve("audio.mp3"), "voice");
        List<String> order = new ArrayList<>();

        SummaryAnalyzer analyzer = new SummaryAnalyzer(
                (path, declared) -> { order.add("duration"); return 3210; },
                path -> { order.add("compress"); return compressed; },
                (path, mime, actor) -> {
                    order.add("observe");
                    assertThat(path).isEqualTo(compressed);
                    assertThat(actor.durationMs()).isEqualTo(3210);
                    return new ObservationPack(List.of(), List.of());
                },
                (path, maximum) -> { order.add("extract"); return audio; },
                (path, prompt) -> { order.add("transcribe"); return "하나. 둘!"; });

        AnalysisResult result = analyzer.analyze(video, context("분석", null));

        assertThat(order).containsExactly(
                "duration", "compress", "observe", "extract", "transcribe");
        assertThat(result.wasCompressed()).isTrue();
        assertThat(result.transcripts()).containsExactly("하나.", "둘!");
        assertThat(compressed).doesNotExist();
        assertThat(audioDirectory).doesNotExist();
    }

    @Test
    void skipsTranscriptionOutsideKoreanAnalysisBranch() throws Exception {
        Path video = Files.writeString(temporary.resolve("take.mp4"), "video");
        int[] transcriptionCalls = {0};
        SummaryAnalyzer analyzer = new SummaryAnalyzer(
                (path, declared) -> 1000,
                path -> path,
                (path, mime, actor) -> new ObservationPack(List.of(), List.of()),
                (path, maximum) -> { transcriptionCalls[0]++; return path; },
                (path, prompt) -> { transcriptionCalls[0]++; return "unexpected"; });

        AnalysisResult result = analyzer.analyze(video, context("표현", 1000));

        assertThat(transcriptionCalls[0]).isZero();
        assertThat(result.transcripts()).isEmpty();
    }

    @Test
    void swallowsEveryTranscriptionFailureAndKeepsObservationResult() throws Exception {
        Path video = Files.writeString(temporary.resolve("take.mp4"), "video");
        Path audioDirectory = Files.createDirectory(temporary.resolve("broken-audio"));
        Path audio = Files.writeString(audioDirectory.resolve("audio.mp3"), "voice");
        SummaryAnalyzer analyzer = new SummaryAnalyzer(
                (path, declared) -> 1000,
                path -> path,
                (path, mime, actor) -> new ObservationPack(List.of(), List.of("불확실")),
                (path, maximum) -> audio,
                (path, prompt) -> { throw new IllegalStateException("transcription down"); });

        AnalysisResult result = analyzer.analyze(video, context("분석", 1000));

        assertThat(result.observationPack().uncertainties()).containsExactly("불확실");
        assertThat(result.transcripts()).isEmpty();
        assertThat(audioDirectory).doesNotExist();
    }

    private static AnalysisContext context(String blockageKind, Integer durationMs) {
        return new AnalysisContext(
                null, null, "users/u/uploads/take.mp4", "video/mp4", "etag",
                durationMs, "상황", "인물", "목표", blockageKind, "세부");
    }
}
