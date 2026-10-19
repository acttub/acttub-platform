package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.UUID;
import java.util.function.Supplier;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.media.VideoRecordChunks;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.GenerateContentResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** 청크 하나가 실패할 때 다시 쓰기·반으로 나누기·빈 구간 남기기와 정리 실패 보고 (practice.analyze). */
class GeminiVideoRecordAnalyzerRetryTest {
    private static final UUID PRACTICE = UUID.fromString("00000000-0000-0000-0000-0000000000a1");

    @TempDir
    Path directory;

    private final List<String> ranges = new ArrayList<>();
    private final List<String> deleted = new ArrayList<>();
    private final List<JsonNode> inputs = new ArrayList<>();
    private final List<String> instructions = new ArrayList<>();
    private final Deque<Supplier<String>> answers = new ArrayDeque<>();
    private final RecordingFailureReporter reporter = new RecordingFailureReporter();
    private final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    private RuntimeException deleteFailure;

    private GeminiVideoRecordAnalyzer analyzer(boolean audio) {
        GeminiGateway gateway = new GeminiGateway() {
            @Override
            public GeminiFile upload(Path path, String mime) {
                return new GeminiFile("files/" + path.getFileName(), "https://files.test/" + path.getFileName(), mime,
                        "ACTIVE");
            }

            @Override
            public GeminiFile get(String name) {
                throw new AssertionError("already active");
            }

            @Override
            public void delete(String name) {
                deleted.add(name);
                if (deleteFailure != null) {
                    throw deleteFailure;
                }
            }

            @Override
            public GenerateContentResponse generateResponse(String model, Content content, GenerateContentConfig config) {
                String text = content.parts().orElseThrow().get(1).text().orElseThrow();
                instructions.add(text);
                inputs.add(StructuredJson.parse(text.lines().findFirst().orElseThrow()));
                String answer = answers.isEmpty() ? "not json" : answers.removeFirst().get();
                return GenerateContentResponse.builder()
                        .candidates(List.of(com.google.genai.types.Candidate.builder()
                                .content(Content.fromParts(com.google.genai.types.Part.fromText(answer))).build()))
                        .build();
            }
        };
        VideoRecordChunks chunks = new VideoRecordChunks() {
            @Override
            public boolean hasAudio(Path source) {
                return audio;
            }

            @Override
            public Path extract(Path source, long start, long end) {
                ranges.add(start + "-" + end);
                try {
                    return Files.createFile(directory.resolve("chunk-" + start + "-" + end + ".mp4"));
                } catch (java.io.IOException failure) {
                    throw new java.io.UncheckedIOException(failure);
                }
            }
        };
        return new GeminiVideoRecordAnalyzer(gateway, chunks, "test-model", reporter, telemetry);
    }

    private static String validChunk(String chunkId) {
        ObjectNode response = (ObjectNode) StructuredJson.resource("/coaching/chunk.json");
        response.put("chunk_id", chunkId);
        response.path("segments").forEach(segment -> {
            ((ObjectNode) segment).putArray("event_ids").add("unknown");
            ((ObjectNode) segment).putArray("utterance_ids");
            ((ObjectNode) segment).putArray("limitation_ids");
        });
        return response.toString();
    }

    @Test
    void unparsableAnswerIsRetriedOnceWithTheRetryNoteAndTheSpokenWordsOfThatChunk() throws Exception {
        answers.add(() -> "not json");
        answers.add(() -> validChunk("chunk_0_8000"));
        SpeechAnalysis speech = new SpeechAnalysis("가지 마 제발", 3.0, List.of(), List.of(), List.of(
                new SpeechFacts.Word("가지", 0.5, 0.9),
                new SpeechFacts.Word("마", 1.0, 1.2),
                new SpeechFacts.Word("뒤", 9.0, 9.5)));

        ObjectNode record = analyzer(true).analyze(directory.resolve("take.mp4"),
                new ActorMaterial("", "", "", "그 외", "", 8000), PRACTICE, null, speech);

        assertThat(record.path("segments")).hasSize(3);
        assertThat(ranges).containsExactly("0-8000");
        assertThat(inputs.getFirst().path("reference_transcript").toString()).isEqualTo(
                "[{\"text\":\"가지\",\"start_ms\":500,\"end_ms\":900},{\"text\":\"마\",\"start_ms\":1000,\"end_ms\":1200}]");
        assertThat(telemetry.calls()).extracting(call -> call.errorMessage())
                .containsExactly("IllegalArgumentException", null);
        assertThat(instructions.get(0)).doesNotContain("직전 결과");
        assertThat(instructions.get(1)).endsWith("\n직전 결과가 구조/참조/시간/전체 구간 검증을 통과하지 못했다. 빠진 구간 없이 다시 기록하라.");
        assertThat(reporter.reports()).isEmpty();
        assertThat(deleted).containsExactly("files/chunk-0-8000.mp4");
    }

    @Test
    void chunkThatKeepsFailingIsSplitInHalvesUntilTheBudgetRunsOutAndThenLeftMissing() {
        deleteFailure = new IllegalStateException("delete failed");

        assertThatThrownBy(() -> analyzer(true).analyze(directory.resolve("take.mp4"),
                new ActorMaterial("", "", "", "그 외", "", 8000), PRACTICE, null, null))
                .isInstanceOf(SummaryParseError.class);

        assertThat(ranges).containsExactly("0-8000", "0-4000", "4000-8000");
        assertThat(telemetry.calls()).hasSize(6);
        assertThat(reporter.reports()).filteredOn(report -> report.kind() == FailureKind.EXTERNAL)
                .extracting(RecordingFailureReporter.Report::context)
                .containsOnly("GeminiVideoRecordAnalyzer.fileCleanup").hasSize(3);
        assertThat(reporter.contexts()).filteredOn(context -> context.startsWith("GeminiVideoRecordAnalyzer.chunk"))
                .containsOnly("GeminiVideoRecordAnalyzer.chunk operation_id=" + PRACTICE).hasSize(3);
    }

    @Test
    void videoWithoutASoundTrackRecordsThatTheAudioIsAbsent() {
        answers.add(() -> {
            ObjectNode response = (ObjectNode) StructuredJson.parse(validChunk("chunk_0_8000"));
            response.putArray("utterances");
            for (String group : List.of("events", "limitations")) {
                response.path(group).forEach(item -> {
                    if (item.has("utterance_ids")) {
                        ((ObjectNode) item).putArray("utterance_ids");
                    }
                });
            }
            return response.toString();
        });

        ObjectNode record = analyzer(false).analyze(directory.resolve("take.mp4"),
                new ActorMaterial("부엌", "엄마", "붙잡기", "표현", "", 8000), PRACTICE, null, null);

        assertThat(record.path("media").path("audio_track_present").asBoolean()).isFalse();
        assertThat(record.path("limitations").findValuesAsText("id")).contains("audio:absent");
        assertThat(record.path("actor_context").path("situation").asText()).isEqualTo("부엌");
        assertThat(record.path("actor_context").path("character_context").asText()).isEqualTo("엄마");
        assertThat(record.path("actor_context").path("goal").asText()).isEqualTo("붙잡기");
    }

    @Test
    void speechInAVideoWithoutASoundTrackIsRejected() {
        answers.add(() -> {
            ObjectNode response = (ObjectNode) StructuredJson.resource("/coaching/chunk.json");
            response.put("chunk_id", "chunk_0_6000");
            return response.toString();
        });

        assertThatThrownBy(() -> analyzer(false).analyze(directory.resolve("take.mp4"),
                new ActorMaterial("", "", "", "그 외", "", 6000), PRACTICE, null, null))
                .isInstanceOf(SummaryParseError.class);

        assertThat(ranges).containsExactly("0-6000");
        assertThat(telemetry.calls()).extracting(call -> call.errorMessage()).first().isNotNull();
        assertThat(inputs.getFirst().path("audio_track_present").asBoolean()).isFalse();
    }
}
