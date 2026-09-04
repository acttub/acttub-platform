package com.acttub.actingapi.feature.analysis.app;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import com.acttub.actingapi.integration.observation.ActorMaterial;
import com.acttub.actingapi.integration.observation.ObservationAnalyzer;
import com.acttub.actingapi.integration.observation.ObservationPack;

/**
 * duration → 압축 → 관찰 순서를 소유하는 분석 진입점.
 *
 * <p><b>별도 받아쓰기는 없다(SOMA-490).</b> 영상을 보는 모델이 소리도 함께 듣고 대사를
 * {@code quote} 에 담으므로, 같은 오디오를 다른 모델에 한 번 더 보내던 단계를 걷어냈다.
 */
public final class SummaryAnalyzer implements AnalysisProcessor {
    private final DurationResolver durationProbe;
    private final VideoCompressor compressor;
    private final ObservationAnalyzer observationAnalyzer;

    public SummaryAnalyzer(
            DurationResolver durationProbe,
            VideoCompressor compressor,
            ObservationAnalyzer observationAnalyzer) {
        this.durationProbe = durationProbe;
        this.compressor = compressor;
        this.observationAnalyzer = observationAnalyzer;
    }

    @Override
    public AnalysisResult analyze(Path videoPath, AnalysisContext context) {
        int durationMs = durationProbe.durationMs(videoPath, context.durationMs());
        Path sendPath = videoPath;
        try {
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
            return new AnalysisResult(observations, !sendPath.equals(videoPath));
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

}
