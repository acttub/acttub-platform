package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import com.acttub.actingapi.integration.media.AudioExtractor;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.acttub.actingapi.platform.observability.FailureClassifier;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.GenerateContentResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class GeminiTranscriberTest {
    @TempDir Path temporary;

    private static final String RESPONSE = """
            {"candidates":[{"content":{"parts":[{"audioTranscription":{
              "text":"가지 마", "words":[
                {"word":"가지", "startOffset":"1s", "endOffset":"2s"},
                {"word":"마", "startOffset":"2.500s", "endOffset":"3s"}]}}]}}]}
            """;

    @Test
    void requestContainsOnlyTranscriptionConfigAndReadsAudioTranscription() throws Exception {
        var gateway = new StubGateway();
        var reporter = new RecordingFailureReporter();
        var transcriber = new GeminiTranscriber(new AudioExtractor(), gateway, reporter, new RecordingLlmTelemetry());
        Path audio = Files.writeString(temporary.resolve("take.wav"), "wav");

        var result = transcriber.transcribe(audio);

        assertThat(gateway.model).isEqualTo("gemini-3.5-transcribe");
        assertThat(new ObjectMapper().readTree(gateway.config.toJson())).isEqualTo(
                new ObjectMapper().readTree("""
                    {"audioTranscriptionConfig":{"languageCodes":["ko-KR"],
                      "wordTimestamp":true,"mode":"VERBATIM"}}
                    """));
        assertThat(gateway.path).isEqualTo(audio);
        assertThat(gateway.mime).isEqualTo("audio/wav");
        assertThat(gateway.contents.parts().orElseThrow()).singleElement().satisfies(part -> {
            assertThat(part.text()).isEmpty();
            assertThat(part.fileData().orElseThrow().mimeType()).contains("audio/wav");
        });
        assertThat(result.transcript()).isEqualTo("가지 마");
        assertThat(result.avgSyllablesPerSec()).isEqualTo(2.0);
        assertThat(result.pauses()).containsExactly(new SpeechAnalysis.Pause(2000, .5, "가지", "마"));
        assertThat(gateway.deleted).containsExactly("files/audio");
        assertThat(reporter.reports()).isEmpty();
    }

    @Test
    void emptySpeechIsValidButTextOnlyOrMissingTranscriptionIsAnExternalFailure() {
        for (String response : List.of("{}", "{\"candidates\":[]}",
                "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"ignored\"}]}}]}",
                RESPONSE.replace("\"words\":[", "\"unused\":["))) {
            var gateway = new StubGateway();
            gateway.response = GenerateContentResponse.fromJson(response);
            var transcriber = new GeminiTranscriber(new AudioExtractor(), gateway, new RecordingFailureReporter(), new RecordingLlmTelemetry());
            assertThatThrownBy(() -> transcriber.transcribe(Path.of("take.wav"))).satisfies(exception -> {
                assertThat(FailureClassifier.classify(exception)).isEqualTo(FailureKind.EXTERNAL);
                assertThat(exception.getCause()).isNotNull();
            });
            assertThat(gateway.deleted).containsExactly("files/audio");
        }
        var empty = GenerateContentResponse.fromJson("""
                {"candidates":[{"content":{"parts":[{"audioTranscription":{"text":"","words":[]}}]}}]}
                """);
        assertThat(GeminiTranscriber.parse(empty)).isEqualTo(new SpeechAnalysis("", 0, List.of(), List.of()));
    }

    @Test
    void generationFailureKeepsCauseAndCleansRemoteFileAndExtractedAudio() throws Exception {
        Path video = temporary.resolve("take.mp4");
        Path audio = Files.writeString(temporary.resolve("take.wav"), "wav");
        var extractor = mock(AudioExtractor.class);
        when(extractor.extract(video)).thenReturn(audio);
        var gateway = new StubGateway();
        var failure = new IllegalStateException("model unavailable");
        gateway.failure = failure;
        var transcriber = new GeminiTranscriber(extractor, gateway, new RecordingFailureReporter(), new RecordingLlmTelemetry());

        assertThatThrownBy(() -> transcriber.analyze(video, null)).hasCause(failure);

        assertThat(audio).doesNotExist();
        assertThat(gateway.deleted).containsExactly("files/audio");
    }

    @Test
    void remoteCleanupFailureIsReportedWithoutLosingSpeechAndLocalAudioIsRemoved() throws Exception {
        Path video = temporary.resolve("take.mp4");
        Path audio = Files.writeString(temporary.resolve("take.wav"), "wav");
        var extractor = mock(AudioExtractor.class);
        when(extractor.extract(video)).thenReturn(audio);
        var gateway = new StubGateway();
        var failure = new IllegalStateException("delete unavailable");
        gateway.cleanupFailure = failure;
        var reporter = new RecordingFailureReporter();
        var transcriber = new GeminiTranscriber(extractor, gateway, reporter, new RecordingLlmTelemetry());

        assertThat(transcriber.analyze(video, null).transcript()).isEqualTo("가지 마");

        assertThat(audio).doesNotExist();
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(failure);
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
            assertThat(report.context()).isEqualTo("GeminiTranscriber.fileCleanup");
        });
    }

    private static final class StubGateway implements GeminiGateway {
        GenerateContentResponse response = GenerateContentResponse.fromJson(RESPONSE);
        GenerateContentConfig config;
        Content contents;
        String model;
        Path path;
        String mime;
        RuntimeException failure;
        RuntimeException cleanupFailure;
        final List<String> deleted = new ArrayList<>();

        @Override public GeminiFile upload(Path path, String mime) {
            this.path = path;
            this.mime = mime;
            return new GeminiFile("files/audio", "https://files.test/audio", mime, "ACTIVE");
        }
        @Override public GeminiFile get(String name) { throw new AssertionError("already active"); }
        @Override public String generate(String model, Content contents, GenerateContentConfig config) {
            throw new AssertionError("transcription must not read response.text()");
        }
        @Override public GenerateContentResponse generateResponse(
                String model, Content contents, GenerateContentConfig config) {
            this.model = model;
            this.contents = contents;
            this.config = config;
            if (failure != null) throw failure;
            return response;
        }
        @Override public void delete(String name) {
            deleted.add(name);
            if (cleanupFailure != null) throw cleanupFailure;
        }
    }
}
