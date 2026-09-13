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
                throw new AssertionError("unexpected gateway method");
            }
            public String generate(String model, Content content, GenerateContentConfig config) {
                assertThat(content.parts().orElseThrow().getFirst().videoMetadata().orElseThrow().fps()).contains(6.0);
                assertThat(config.thinkingConfig().orElseThrow().toJson()).contains("LOW");
                ObjectNode response = (ObjectNode) StructuredJson.resource("/coaching/chunk.json");
                response.put("chunk_id", "chunk_0_8000");
                return response.toString();
            }
        };
        VideoRecordChunks chunks = new VideoRecordChunks() {
            public boolean hasAudio(Path source) { return true; }
            public Path extract(Path source, long start, long end) {
                assertThat(start).isZero(); assertThat(end).isEqualTo(8000); return chunk;
            }
        };
        var analyzer = new GeminiVideoRecordAnalyzer(gateway, chunks, "test-model",
                new RecordingFailureReporter(), new RecordingLlmTelemetry());
        ObjectNode record = analyzer.analyze(directory.resolve("original.mp4"),
                new ActorMaterial("", "", "", "그 외", "", 8000), UUID.randomUUID(), null);
        assertThat(record.path("segments")).hasSize(3);
        assertThat(record.path("limitations").toString()).contains("capture:sampling", "초당 6프레임");
        record.path("limitations").forEach(l -> StructuredJson.validate("layer1_limitation", l));
        record.path("segments").forEach(s -> assertThat(s.path("limitation_ids").toString()).contains("capture:sampling"));
        assertThat(Files.exists(chunk)).isFalse();
        assertThat(deleted[0]).isTrue();
    }
}
