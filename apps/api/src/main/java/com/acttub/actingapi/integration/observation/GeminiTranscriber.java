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
    public SpeechAnalysis analyze(Path videoPath, UUID practiceSessionId, UUID userId) {
        Path audio = extractor.extract(videoPath);
        try {
            return transcribe(audio, practiceSessionId, userId);
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
        return transcribe(audioPath, practiceSessionId, null);
    }

    public SpeechAnalysis transcribe(Path audioPath, UUID practiceSessionId, UUID userId) {
        GeminiFile uploaded = null;
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
            GenerateContentResponse response = recorded(practiceSessionId, userId,
                    Content.fromParts(Part.fromUri(active.uri(), active.mimeType())), config);
            return parse(response);
        } catch (Exception exception) {
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

    private GenerateContentResponse recorded(
            UUID practiceSessionId, UUID userId, Content contents, GenerateContentConfig config) {
        Instant startedAt = Instant.now();
        try {
            GenerateContentResponse response = gateway.generateResponse(MODEL, contents, config);
            // 파싱 전에 남겨야 읽을 수 없는 응답도 원문과 사용량을 잃지 않는다.
            record(practiceSessionId, userId, startedAt, response.toJson(), GeminiUsage.tokens(response), null);
            return response;
        } catch (RuntimeException failure) {
            record(practiceSessionId, userId, startedAt, "", LlmTokens.unknown(),
                    failure.getClass().getSimpleName());
            throw failure;
        }
    }

    /**
     * 받아쓰기 한 번을 남긴다. 입력이 소리라 프롬프트 자리에 담을 글이 없어 무엇을 보냈는지만
     * 적는다 — 이 자리에서 볼 것은 결과와 걸린 시간이다.
     */
    private void record(
            UUID practiceSessionId,
            UUID userId,
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
                userId,
                MODEL,
                "(오디오) ko-KR VERBATIM",
                output,
                tokens,
                startedAt,
                Duration.between(startedAt, Instant.now()),
                errorMessage,
                java.util.Map.of()));
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
