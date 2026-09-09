package com.acttub.actingapi.feature.analysis.app;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executors;
import java.util.logging.Level;
import java.util.logging.Logger;

import com.acttub.actingapi.integration.observation.ActorMaterial;
import com.acttub.actingapi.integration.observation.ObservationAnalyzer;
import com.acttub.actingapi.integration.observation.ObservationPack;
import com.acttub.actingapi.integration.observation.SpeechAnalysis;
import com.acttub.actingapi.integration.observation.SpeechAnalyzer;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;

/**
 * AnalysisWorker의 분석 진입점. 영상 관찰과 원본 소리 계측을 병행해 한 팩으로 합친다.
 */
public final class SummaryAnalyzer implements AnalysisProcessor {
    private static final Logger LOGGER = Logger.getLogger(SummaryAnalyzer.class.getName());
    private final DurationResolver durationProbe;
    private final VideoCompressor compressor;
    private final ObservationAnalyzer observationAnalyzer;
    private final SpeechAnalyzer speechAnalyzer;
    private final FailureReporter failureReporter;

    public SummaryAnalyzer(
            DurationResolver durationProbe,
            VideoCompressor compressor,
            ObservationAnalyzer observationAnalyzer,
            SpeechAnalyzer speechAnalyzer,
            FailureReporter failureReporter) {
        this.durationProbe = durationProbe;
        this.compressor = compressor;
        this.observationAnalyzer = observationAnalyzer;
        this.speechAnalyzer = speechAnalyzer;
        this.failureReporter = failureReporter;
    }

    @Override
    public AnalysisResult analyze(Path videoPath, AnalysisContext context) {
        int durationMs = durationProbe.durationMs(videoPath, context.durationMs());
        Path sendPath = videoPath;
        // close가 음성 작업의 종료까지 기다려 워커가 원본을 먼저 지우지 않게 한다.
        try (var executor = Executors.newVirtualThreadPerTaskExecutor()) {
            var speech = CompletableFuture.supplyAsync(() -> speech(videoPath, context), executor);
            sendPath = compressor.compress(videoPath);
            ObservationPack observations = observationAnalyzer.analyze(
                    sendPath,
                    context.mimeType(),
                    new ActorMaterial(
                            context.situation(),
                            context.characterContext(),
                            context.goal(),
                            context.blockageKind(),
                            context.blockageDetail() == null ? "" : context.blockageDetail(),
                            durationMs));
            ObservationPack pack = new ObservationPack(
                    observations.sceneSummary(), observations.timeline(), speech.join(),
                    observations.observations(), observations.uncertainties());
            return new AnalysisResult(pack, !sendPath.equals(videoPath), durationMs);
        } finally {
            if (!sendPath.equals(videoPath)) {
                try {
                    Files.deleteIfExists(sendPath);
                } catch (IOException ignored) {
                    // 압축본 정리 실패는 분석 결과를 뒤집지 않는다.
                }
            }
        }
    }

    private SpeechAnalysis speech(Path videoPath, AnalysisContext context) {
        try {
            return speechAnalyzer.analyze(videoPath);
        } catch (Exception exception) {
            LOGGER.log(Level.WARNING, "speech analysis failed: " + context.operationId(), exception);
            failureReporter.report(exception,
                    new FailureContext("SummaryAnalyzer.speech", context.operationId()));
            return null;
        }
    }
}
