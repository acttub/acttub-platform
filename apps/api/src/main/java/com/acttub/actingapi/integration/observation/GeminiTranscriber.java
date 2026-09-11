package com.acttub.actingapi.integration.observation;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.integration.media.AudioExtractor;
import com.acttub.actingapi.platform.observability.ExternalFailure;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.platform.observability.LlmTokens;
import com.google.genai.types.AudioTranscriptionConfig;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.GenerateContentResponse;
import com.google.genai.types.Part;

/** 받아쓰기 모델에는 지시문·JSON 모드·MediaResolution을 보내면 안 된다(400). */
public final class GeminiTranscriber implements SpeechAnalyzer {
    static final String MODEL = "gemini-3.5-transcribe";
    private final AudioExtractor extractor;
    private final GeminiGateway gateway;
    private final FailureReporter failureReporter;
    private final LlmTelemetry telemetry;

    GeminiTranscriber(
            AudioExtractor extractor,
            GeminiGateway gateway,
            FailureReporter failureReporter,
            LlmTelemetry telemetry) {
        this.extractor = extractor;
        this.gateway = gateway;
        this.failureReporter = failureReporter;
        this.telemetry = telemetry;
    }

    @Override
    public SpeechAnalysis analyze(Path videoPath, UUID practiceSessionId) {
        Path audio = extractor.extract(videoPath);
        try {
            return transcribe(audio, practiceSessionId);
        } finally {
            try {
                Files.deleteIfExists(audio);
            } catch (IOException exception) {
                failureReporter.report(exception, FailureKind.UNEXPECTED,
                        new FailureContext("GeminiTranscriber.audioCleanup"));
            }
        }
    }

    public SpeechAnalysis transcribe(Path audioPath) {
        return transcribe(audioPath, null);
    }

    public SpeechAnalysis transcribe(Path audioPath, UUID practiceSessionId) {
        GeminiFile uploaded = null;
        Instant startedAt = Instant.now();
        try {
            uploaded = gateway.upload(audioPath, "audio/wav");
            GeminiFile active = FileActivationPoller.waitUntilActive(
                    uploaded, gateway::get,
                    GeminiObservationAnalyzer.ACTIVE_TIMEOUT, GeminiObservationAnalyzer.POLL_INTERVAL,
                    System::nanoTime, FileActivationPoller.Sleeper.real());
            GenerateContentConfig config = GenerateContentConfig.builder()
                    .audioTranscriptionConfig(AudioTranscriptionConfig.builder()
                            .languageCodes(List.of("ko-KR"))
                            .wordTimestamp(true)
                            .mode("VERBATIM")
                            .build())
                    .build();
            GenerateContentResponse response = gateway.generateResponse(
                    MODEL, Content.fromParts(Part.fromUri(active.uri(), "audio/wav")), config);
            SpeechAnalysis analysis = parse(response);
            record(practiceSessionId, startedAt, analysis.toString(), tokens(response), null);
            return analysis;
        } catch (Exception exception) {
            record(practiceSessionId, startedAt, "", LlmTokens.unknown(),
                    exception.getMessage() == null ? exception.toString() : exception.getMessage());
            throw new TranscriptionFailure("audio transcription failed", exception);
        } finally {
            if (uploaded != null) {
                try {
                    gateway.delete(uploaded.name());
                } catch (Exception exception) {
                    failureReporter.report(exception, FailureKind.EXTERNAL,
                            new FailureContext("GeminiTranscriber.fileCleanup"));
                }
            }
        }
    }

    /**
     * 받아쓰기 한 번을 남긴다. 입력이 소리라 프롬프트 자리에 담을 글이 없어 무엇을 보냈는지만
     * 적는다 — 이 자리에서 볼 것은 결과와 걸린 시간이다.
     */
    private void record(
            UUID practiceSessionId,
            Instant startedAt,
            String output,
            LlmTokens tokens,
            String errorMessage) {
        if (practiceSessionId == null) {
            return;
        }
        telemetry.record(new LlmCall(
                LlmStep.TRANSCRIPTION,
                practiceSessionId,
                null,
                MODEL,
                "(오디오) ko-KR VERBATIM",
                output,
                tokens,
                startedAt,
                Duration.between(startedAt, Instant.now()),
                errorMessage,
                java.util.Map.of()));
    }

    private static LlmTokens tokens(GenerateContentResponse response) {
        return response.usageMetadata()
                .map(usage -> LlmTokens.of(
                        usage.promptTokenCount().orElse(null),
                        usage.candidatesTokenCount().orElse(null),
                        usage.totalTokenCount().orElse(null)))
                .orElseGet(LlmTokens::unknown);
    }

    static SpeechAnalysis parse(GenerateContentResponse response) {
        var candidates = response.candidates().orElseThrow();
        var parts = candidates.getFirst().content().orElseThrow().parts().orElseThrow();
        var transcription = parts.getFirst().audioTranscription().orElseThrow();
        String text = transcription.text().orElse("");
        var words = transcription.words().orElse(List.of());
        if (!text.isBlank() && words.isEmpty()) {
            throw new IllegalArgumentException("transcription has text without word timestamps");
        }
        return SpeechFacts.calculate(text, words.stream()
                .map(w -> new SpeechFacts.Word(w.word().orElseThrow(),
                        seconds(w.startOffset().orElse(null)), seconds(w.endOffset().orElse(null))))
                .toList());
    }

    static double seconds(String offset) {
        return offset == null ? 0 : Double.parseDouble(offset.replaceFirst("s$", ""));
    }

    private static final class TranscriptionFailure extends RuntimeException implements ExternalFailure {
        TranscriptionFailure(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
