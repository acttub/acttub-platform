package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.GenerateContentResponse;
import org.junit.jupiter.api.Test;

class GeminiLayerOneObserverCallTest {
    private static final String OK = """
            {"candidates":[{"content":{"role":"model","parts":[{"text":"{\\"chunks\\":[{\\"i\\":0,\\"heard\\":\\"\\",\\"seen\\":\\"정면을 본다\\",\\"reading\\":\\"\\"}],\\"overall\\":\\"담담하다\\"}"}]}}],
             "usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":20}}""";
    private static final String BROKEN = """
            {"candidates":[{"content":{"role":"model","parts":[{"text":"{\\"chunks\\":[{"}]}}]}""";

    private static final class Gateway implements GeminiGateway {
        final List<GenerateContentResponse> responses = new ArrayList<>();
        final List<String> deleted = new ArrayList<>();
        String model;
        int calls;
        RuntimeException failure;
        @Override public GeminiFile upload(Path path, String mime) {
            return new GeminiFile("files/v", "https://files.test/v", mime, "ACTIVE");
        }
        @Override public GeminiFile get(String name) { throw new AssertionError("already active"); }
        @Override public GenerateContentResponse generateResponse(String model, Content contents, GenerateContentConfig config) {
            this.model = model;
            if (failure != null) throw failure;
            return responses.get(Math.min(calls++, responses.size() - 1));
        }
        @Override public void delete(String name) { deleted.add(name); }
    }

    private static SpeechAnalyzer words(SpeechFacts.Word... words) {
        return (video, practice, user) -> new SpeechAnalysis("", 0, List.of(), List.of(), List.of(words));
    }

    @Test
    void writesBlockRecordsCallAndDeletesFile() {
        var gateway = new Gateway();
        gateway.responses.add(GenerateContentResponse.fromJson(OK));
        var telemetry = new RecordingLlmTelemetry();
        var observer = new GeminiLayerOneObserver(words(new SpeechFacts.Word("됐어", 1, 2)), gateway, null,
                new ObjectMapper(), new RecordingFailureReporter(), telemetry);
        String block = observer.observe(Path.of("v.mp4"), "", "상황", UUID.randomUUID(), UUID.randomUUID());
        assertThat(block).contains("\"됐어\" — 본 것: 정면을 본다").contains("장면 흐름: 담담하다");
        assertThat(gateway.model).isEqualTo(GeminiLayerOneObserver.DEFAULT_MODEL);
        assertThat(gateway.deleted).containsExactly("files/v");
        assertThat(telemetry.calls()).singleElement().satisfies(call -> assertThat(call.errorMessage()).isNull());
    }

    @Test
    void retriesBrokenJsonOnceThenGivesUp() {
        var gateway = new Gateway();
        gateway.responses.add(GenerateContentResponse.fromJson(BROKEN));
        var telemetry = new RecordingLlmTelemetry();
        var observer = new GeminiLayerOneObserver(words(new SpeechFacts.Word("됐어", 1, 2)), gateway, "gemini-x",
                new ObjectMapper(), new RecordingFailureReporter(), telemetry);
        assertThat(observer.observe(Path.of("v.mp4"), "video/mp4", null, UUID.randomUUID(), null)).isEmpty();
        assertThat(gateway.calls).isEqualTo(2);
        assertThat(telemetry.calls()).singleElement().satisfies(call -> assertThat(call.errorMessage()).isEqualTo("unparsed_observation"));
    }

    @Test
    void noSpeechMeansNoCall() {
        var gateway = new Gateway();
        var observer = new GeminiLayerOneObserver(words(), gateway, null, new ObjectMapper(), new RecordingFailureReporter(),
                new RecordingLlmTelemetry());
        assertThat(observer.observe(Path.of("v.mp4"), "video/mp4", "", UUID.randomUUID(), null)).isEmpty();
        assertThat(gateway.model).isNull();
    }

    @Test
    void modelFailureIsRecordedAndFileStillDeleted() {
        var gateway = new Gateway();
        gateway.failure = new IllegalStateException("down");
        var telemetry = new RecordingLlmTelemetry();
        var observer = new GeminiLayerOneObserver(words(new SpeechFacts.Word("됐어", 1, 2)), gateway, null,
                new ObjectMapper(), new RecordingFailureReporter(), telemetry);
        assertThatThrownBy(() -> observer.observe(Path.of("v.mp4"), "video/mp4", "", UUID.randomUUID(), null))
                .isInstanceOf(IllegalStateException.class);
        assertThat(gateway.deleted).containsExactly("files/v");
        assertThat(telemetry.calls()).singleElement().satisfies(call -> assertThat(call.errorMessage()).isEqualTo("IllegalStateException"));
    }
}
