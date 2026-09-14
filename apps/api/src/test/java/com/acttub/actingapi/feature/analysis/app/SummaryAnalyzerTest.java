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
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.platform.ledger.ExternalOperationExecution;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.io.TempDir;

class SummaryAnalyzerTest {

    private static final java.util.UUID PRACTICE = java.util.UUID.randomUUID();
    private static final java.util.UUID USER = java.util.UUID.randomUUID();

    @TempDir
    Path temporary;

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void threeLayerAnalysisObservesBothPortsEvenWhenSpeechFallsBack(boolean speechFails) throws Exception {
        Path video = Files.writeString(temporary.resolve("record.mp4"), "video");
        var record = (com.fasterxml.jackson.databind.node.ObjectNode)
                StructuredJson.resource("/coaching/record.json");
        var speech = new SpeechAnalysis("가지 마", 2.0, List.of(), List.of());
        var reporter = new RecordingFailureReporter();
        List<String> calls = new ArrayList<>();
        var starts = new java.util.concurrent.atomic.AtomicInteger();
        var analyzer = new SummaryAnalyzer((path, declared) -> 1000,
                path -> { throw new AssertionError("legacy compression must not run"); },
                (path, mime, actor, practiceId, actorId) -> { throw new AssertionError("legacy observation must not run"); },
                (path, practiceId, actorId) -> {
                    assertThat(calls).containsExactly("speech");
                    if (speechFails) { throw new IllegalStateException("speech unavailable"); }
                    return speech;
                }, reporter,
                (path, actor, practiceId, actorId, observedSpeech) -> {
                    assertThat(calls).containsExactly("speech", "observation");
                    assertThat(path).isEqualTo(video);
                    assertThat(observedSpeech).isSameAs(speechFails ? null : speech);
                    return record;
                });
        var context = new AnalysisContext(java.util.UUID.randomUUID(), PRACTICE, "take.mp4", "video/mp4",
                "etag", 1000, "", "", "", "그 외", "", "three_layers_v1", USER);

        try (var observation = new ExternalOperationExecution(context.operationId(),
                () -> starts.incrementAndGet() == 1, calls::add, System::nanoTime)) {
            assertThat(analyzer.analyze(video, context).videoRecord()).isSameAs(record);
        }

        assertThat(starts).hasValue(1);
        assertThat(calls).containsExactly("speech", "observation");
        assertThat(reporter.reports()).hasSize(speechFails ? 1 : 0);
    }

    @Test
    void observationAndSpeechOverlapForEveryBranchAndMergeIntoOnePack() throws Exception {
        for (String kind : List.of("분석", "표현", "그 외")) {
            Path video = Files.writeString(temporary.resolve("take.mp4"), "video");
            Path compressed = Files.writeString(temporary.resolve("small.mp4"), "small");
            var started = new CountDownLatch(2);
            var speech = new SpeechAnalysis("가지 마", 2.0, List.of(), List.of());
            var reporter = new RecordingFailureReporter();
            var analyzer = new SummaryAnalyzer((path, declared) -> 1000, path -> compressed,
                    (path, mime, actor, practiceId, actorId) -> {
                        awaitBoth(started);
                        assertThat(practiceId).isEqualTo(PRACTICE);
                        assertThat(actorId).isEqualTo(USER);
                        assertThat(path).isEqualTo(compressed);
                        return new ObservationPack("장면", "0:01에 멈춘다", null, List.of(), List.of());
                    }, (path, practiceId, actorId) -> {
                        awaitBoth(started);
                        assertThat(practiceId).isEqualTo(PRACTICE);
                        assertThat(actorId).isEqualTo(USER);
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
                (path, mime, actor, practiceId, actorId) -> new ObservationPack(
                        "장면", "0:01에 멈춘다", null, List.of(), List.of()),
                (path, practiceId, actorId) -> {
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
                (path, mime, actor, practiceId, actorId) -> {
                    order.add("observe");
                    assertThat(path).isEqualTo(compressed);
                    assertThat(actor.durationMs()).isEqualTo(3210);
                    return new ObservationPack("장면 요약", List.of(), List.of());
                }, (path, practiceId, actorId) -> null, new RecordingFailureReporter());

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
                (path, mime, actor, practiceId, actorId) -> new ObservationPack("", List.of(), List.of("불확실")),
                (path, practiceId, actorId) -> null, new RecordingFailureReporter());

        AnalysisResult result = analyzer.analyze(video, context("표현", 1000));

        assertThat(result.wasCompressed()).isFalse();
        assertThat(result.observationPack().uncertainties()).containsExactly("불확실");
        assertThat(video).exists();
    }

    private static AnalysisContext context(String blockageKind, Integer durationMs) {
        return new AnalysisContext(
                null, PRACTICE, "users/u/uploads/take.mp4", "video/mp4", "etag",
                durationMs, "상황", "인물", "목표", blockageKind, "세부", USER);
    }
}
