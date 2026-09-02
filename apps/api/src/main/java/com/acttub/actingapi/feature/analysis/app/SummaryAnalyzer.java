package com.acttub.actingapi.feature.analysis.app;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.logging.Level;
import java.util.logging.Logger;

import com.acttub.actingapi.feature.analysis.domain.TranscriptSegments;
import com.acttub.actingapi.integration.observation.ActorMaterial;
import com.acttub.actingapi.integration.observation.ObservationAnalyzer;
import com.acttub.actingapi.integration.observation.ObservationPack;

/** duration → 압축 → 관찰 → 받아쓰기 순서를 소유하는 분석 진입점. */
public final class SummaryAnalyzer implements AnalysisProcessor {
    public static final long TRANSCRIPTION_MAX_DURATION_MS = 120_000L;
    public static final String TRANSCRIPTION_SYSTEM_PROMPT = """
            너는 연기 영상의 음성을 한국어로 받아쓴다.

            - 실제로 들리는 발화만 적고, 해석·요약·화자 이름·행동 묘사를 넣지 않는다.
            - 앞뒤 대사의 연결이 보이도록 모든 발화를 정확한 순서로 적는다.
            - 대사 하나마다 줄을 바꾼다. 시각, 화자 표지, 글머리표는 붙이지 않는다.
            - 알아듣지 못한 부분을 문맥으로 지어내지 않는다. 발화가 없거나 전혀 알아들을 수 없으면 빈 문자열을 낸다.""";

    private static final Logger LOGGER = Logger.getLogger(SummaryAnalyzer.class.getName());

    private final DurationResolver durationProbe;
    private final VideoCompressor compressor;
    private final ObservationAnalyzer observationAnalyzer;
    private final AudioExtractor audioExtractor;
    private final AudioTranscriber audioTranscriber;

    public SummaryAnalyzer(
            DurationResolver durationProbe,
            VideoCompressor compressor,
            ObservationAnalyzer observationAnalyzer,
            AudioExtractor audioExtractor,
            AudioTranscriber audioTranscriber) {
        this.durationProbe = durationProbe;
        this.compressor = compressor;
        this.observationAnalyzer = observationAnalyzer;
        this.audioExtractor = audioExtractor;
        this.audioTranscriber = audioTranscriber;
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
            List<String> transcripts = transcribe(videoPath);
            return new AnalysisResult(observations, !sendPath.equals(videoPath), transcripts);
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

    /**
     * 갈래와 무관하게 받아쓴다. 세 갈래(분석·표현·그 외) 모두의 코치가 대사를 인용해 말해야
     * 하므로 갈래로 가르던 조건을 없앴다. 실패는 삼키고 빈 목록을 낸다 — 받아쓰기가 없어도
     * 분석은 성립한다.
     */
    private List<String> transcribe(Path videoPath) {
        Path audioPath = null;
        try {
            audioPath = audioExtractor.extract(videoPath, TRANSCRIPTION_MAX_DURATION_MS);
            return TranscriptSegments.fromText(audioTranscriber.transcribe(
                    audioPath, TRANSCRIPTION_SYSTEM_PROMPT));
        } catch (Exception exception) {
            LOGGER.log(Level.WARNING, "transcription failed; continuing analysis", exception);
            return List.of();
        } finally {
            if (audioPath != null) {
                audioExtractor.discard(audioPath);
            }
        }
    }
}
