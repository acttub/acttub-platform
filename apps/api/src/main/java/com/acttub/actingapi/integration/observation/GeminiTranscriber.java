package com.acttub.actingapi.integration.observation;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import com.acttub.actingapi.integration.media.AudioExtractor;
import com.acttub.actingapi.platform.observability.ExternalFailure;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
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

    GeminiTranscriber(AudioExtractor extractor, GeminiGateway gateway, FailureReporter failureReporter) {
        this.extractor = extractor;
        this.gateway = gateway;
        this.failureReporter = failureReporter;
    }

    @Override
    public SpeechAnalysis analyze(Path videoPath) {
        Path audio = extractor.extract(videoPath);
        try {
            return transcribe(audio);
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
            GenerateContentResponse response = gateway.generateResponse(
                    MODEL, Content.fromParts(Part.fromUri(active.uri(), "audio/wav")), config);
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
