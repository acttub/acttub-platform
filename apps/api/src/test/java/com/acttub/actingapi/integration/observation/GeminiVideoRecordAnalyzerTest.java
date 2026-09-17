package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.media.VideoRecordChunks;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.GenerateContentResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class GeminiVideoRecordAnalyzerTest {
    @TempDir Path directory;
    @Test void allFailedChunksPreserveOriginalFailure() {
        var chunks = org.mockito.Mockito.mock(VideoRecordChunks.class);
        var original = new IllegalStateException("chunk extraction failed");
        org.mockito.Mockito.when(chunks.extract(org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyLong(), org.mockito.ArgumentMatchers.anyLong())).thenThrow(original);
        var analyzer = new GeminiVideoRecordAnalyzer(org.mockito.Mockito.mock(GeminiGateway.class), chunks,
                "test-model", new RecordingFailureReporter(), new RecordingLlmTelemetry());
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> analyzer.analyze(directory.resolve("take.mp4"),
                new ActorMaterial("", "", "", "그 외", "", 4000), UUID.randomUUID(), null, null))
                .isInstanceOf(SummaryParseError.class).hasCause(original);
    }

    @Test void explicitSamplingAndTimingLimitsSurviveAssemblyAndTemporaryMediaIsRemoved() throws Exception {
        Path chunk = Files.createFile(directory.resolve("chunk.mp4"));
        boolean[] deleted = {false};
        GeminiGateway gateway = new GeminiGateway() {
            public GeminiFile upload(Path path, String mime) {
                assertThat(path).isEqualTo(chunk);
                return new GeminiFile("files/chunk", "https://files.test/chunk", mime, "ACTIVE");
            }
            public GeminiFile get(String name) { throw new AssertionError("already active"); }
            public void delete(String name) { assertThat(name).isEqualTo("files/chunk"); deleted[0] = true; }
            public GenerateContentResponse generateResponse(String model, Content content, GenerateContentConfig config) {
                return GenerateContentResponse.builder()
                        .candidates(java.util.List.of(com.google.genai.types.Candidate.builder()
                                .content(Content.fromParts(com.google.genai.types.Part.fromText(generate(model, content, config))))
                                .build()))
                        .usageMetadata(com.google.genai.types.GenerateContentResponseUsageMetadata.builder()
                                .promptTokenCount(100).candidatesTokenCount(50).thoughtsTokenCount(10).totalTokenCount(160).build())
                        .build();
            }
            public String generate(String model, Content content, GenerateContentConfig config) {
                assertThat(content.parts().orElseThrow().getFirst().videoMetadata().orElseThrow().fps()).contains(6.0);
                assertThat(config.thinkingConfig().orElseThrow().toJson()).contains("LOW");
                var timingSchemas = StructuredJson.parse(config.responseSchema().orElseThrow().toJson())
                        .findValues("timing_basis");
                assertThat(timingSchemas).isNotEmpty().allSatisfy(basis ->
                        assertThat(basis.path("enum").toString()).isEqualTo("[\"estimated\"]"));
                ObjectNode response = (ObjectNode) StructuredJson.resource("/coaching/chunk.json");
                response.put("chunk_id", "chunk_0_8000");
                response.path("segments").forEach(segment -> {
                    ((ObjectNode) segment).putArray("event_ids").add("unknown");
                    ((ObjectNode) segment).putArray("utterance_ids");
                    ((ObjectNode) segment).putArray("limitation_ids");
                });
                return response.toString();
            }
        };
        VideoRecordChunks chunks = new VideoRecordChunks() {
            public boolean hasAudio(Path source) { return true; }
            public Path extract(Path source, long start, long end) {
                assertThat(start).isZero(); assertThat(end).isEqualTo(8000); return chunk;
            }
        };
        UUID userId = UUID.randomUUID();
        var telemetry = new RecordingLlmTelemetry();
        var analyzer = new GeminiVideoRecordAnalyzer(gateway, chunks, "test-model",
                new RecordingFailureReporter(), telemetry);
        ObjectNode record = analyzer.analyze(directory.resolve("original.mp4"),
                new ActorMaterial("", "", "", "그 외", "", 8000), UUID.randomUUID(), userId, null);
        assertThat(record.path("segments")).hasSize(3);
        assertThat(record.path("limitations").toString()).contains("capture:sampling", "초당 6프레임");
        record.path("limitations").forEach(l -> StructuredJson.validate("layer1_limitation", l));
        record.path("segments").forEach(s -> assertThat(s.path("limitation_ids").toString()).contains("capture:sampling"));
        assertThat(Files.exists(chunk)).isFalse();
        assertThat(deleted[0]).isTrue();
        assertThat(telemetry.calls()).singleElement().satisfies(call -> {
            assertThat(call.userId()).isEqualTo(userId);
            assertThat(call.tokens().input()).isEqualTo(100);
            assertThat(call.tokens().output()).isEqualTo(60);
        });
    }
}
