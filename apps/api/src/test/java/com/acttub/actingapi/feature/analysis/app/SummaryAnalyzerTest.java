package com.acttub.actingapi.feature.analysis.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.integration.observation.ObservationPack;
import com.acttub.actingapi.integration.observation.SpeechAnalysis;
import org.junit.jupiter.api.Test;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.io.TempDir;

class SummaryAnalyzerTest {

    @TempDir
    Path temporary;

    @Test
    void observationAndSpeechOverlapForEveryBranchAndMergeIntoOnePack() throws Exception {
        for (String kind : List.of("분석", "표현", "그 외")) {
            Path video = Files.writeString(temporary.resolve("take.mp4"), "video");
            Path compressed = Files.writeString(temporary.resolve("small.mp4"), "small");
            var started = new CountDownLatch(2);
            var speech = new SpeechAnalysis("가지 마", 2.0, List.of(), List.of());
            var reporter = new RecordingFailureReporter();
            var analyzer = new SummaryAnalyzer((path, declared) -> 1000, path -> compressed,
                    (path, mime, actor) -> {
                        awaitBoth(started);
                        assertThat(path).isEqualTo(compressed);
                        return new ObservationPack("장면", "0:01에 멈춘다", null, List.of(), List.of());
                    }, path -> {
                        awaitBoth(started);
                        assertThat(path).isEqualTo(video).exists();
                        return speech;
                    }, reporter);

            var result = analyzer.analyze(video, context(kind, 1000));

            assertThat(result.observationPack().timeline()).isEqualTo("0:01에 멈춘다");
            assertThat(result.observationPack().speech()).isSameAs(speech);
            assertThat(result.durationMs()).isEqualTo(1000);
            assertThat(result.wasCompressed()).isTrue();
            assertThat(compressed).doesNotExist();
            assertThat(video).exists();
            assertThat(reporter.reports()).isEmpty();
        }
    }

    /**
     * 받아쓰기는 관찰을 인질로 잡지 않는다 — 새로 들인 층이 실패해도 배우는 코칭까지 간다.
     * 실패는 삼키지 않고 리포터로 올라가야 운영에서 조용히 꺼진 것을 알아챈다.
     */
    @Test
    void speechFailureKeepsTheAnalysisAndIsStillReported() throws Exception {
        Path video = Files.writeString(temporary.resolve("take.mp4"), "video");
        Path compressed = Files.writeString(temporary.resolve("small.mp4"), "small");
        var reporter = new RecordingFailureReporter();
        var analyzer = new SummaryAnalyzer((path, declared) -> 1000, path -> compressed,
                (path, mime, actor) -> new ObservationPack(
                        "장면", "0:01에 멈춘다", null, List.of(), List.of()),
                path -> {
                    throw new IllegalStateException("transcribe unavailable");
                }, reporter);

        var result = analyzer.analyze(video, context("분석", 1000));

        assertThat(result.observationPack().speech()).isNull();
        assertThat(result.observationPack().timeline()).isEqualTo("0:01에 멈춘다");
        assertThat(result.observationPack().sceneSummary()).isEqualTo("장면");
        assertThat(reporter.reports()).hasSize(1);
    }

    private static void awaitBoth(CountDownLatch started) {
        started.countDown();
        try {
            assertThat(started.await(5, TimeUnit.SECONDS)).as("both calls overlap").isTrue();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new AssertionError(exception);
        }
    }

    @Test
    void resolvesDurationThenCompressesAndObserves() throws Exception {
        Path video = Files.writeString(temporary.resolve("take.mp4"), "video");
        Path compressed = Files.writeString(temporary.resolve("take.gemini.mp4"), "small");
        List<String> order = new ArrayList<>();

        SummaryAnalyzer analyzer = new SummaryAnalyzer(
                (path, declared) -> { order.add("duration"); return 3210; },
                path -> { order.add("compress"); return compressed; },
                (path, mime, actor) -> {
                    order.add("observe");
                    assertThat(path).isEqualTo(compressed);
                    assertThat(actor.durationMs()).isEqualTo(3210);
                    return new ObservationPack("장면 요약", List.of(), List.of());
                }, path -> null, new RecordingFailureReporter());

        AnalysisResult result = analyzer.analyze(video, context("분석", null));

        assertThat(order).containsExactly("duration", "compress", "observe");
        assertThat(result.wasCompressed()).isTrue();
        assertThat(result.observationPack().sceneSummary()).isEqualTo("장면 요약");
        assertThat(compressed).doesNotExist();
    }

    /** 압축이 원본을 그대로 돌려주면 지울 것이 없고, 압축했다고 말하지도 않는다. */
    @Test
    void uncompressedVideoIsReportedAsSuchAndKept() throws Exception {
        Path video = Files.writeString(temporary.resolve("take.mp4"), "video");

        SummaryAnalyzer analyzer = new SummaryAnalyzer(
                (path, declared) -> 1000,
                path -> path,
                (path, mime, actor) -> new ObservationPack("", List.of(), List.of("불확실")),
                path -> null, new RecordingFailureReporter());

        AnalysisResult result = analyzer.analyze(video, context("표현", 1000));

        assertThat(result.wasCompressed()).isFalse();
        assertThat(result.observationPack().uncertainties()).containsExactly("불확실");
        assertThat(video).exists();
    }

    private static AnalysisContext context(String blockageKind, Integer durationMs) {
        return new AnalysisContext(
                null, null, "users/u/uploads/take.mp4", "video/mp4", "etag",
                durationMs, "상황", "인물", "목표", blockageKind, "세부");
    }
}
