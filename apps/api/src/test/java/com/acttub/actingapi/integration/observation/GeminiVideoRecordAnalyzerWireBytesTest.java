package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.integration.media.VideoRecordChunks;
import com.acttub.actingapi.support.FrozenValue;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.google.genai.types.Candidate;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.GenerateContentResponse;
import com.google.genai.types.Part;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * 전체 기록 청크 요청에서 우리 코드가 Gemini SDK 에 넘기는 값을 고정한다. 청크 입력은 우리 코드가 JSON 글로 만들어 넘기므로
 * 그 글을 바이트 그대로 본다. 응답 스키마는 우리 코드가 JSON 글로 만들어 {@code Schema.fromJson} 에 넘기는데, 그 글은 비공개
 * 정적 필드 안에서만 쓰여 본 코드를 고치지 않고는 꺼낼 수 없다. 그래서 SDK 가 그 글을 읽어 만든 {@code Schema} 를 SDK 가 다시
 * 쓴 JSON 으로 본다. 키 순서와 값은 우리 글에서 그대로 온다. 기대값은 {@code frozen/wire-bytes/gemini-video-record-*} 이고
 * 마지막에 줄바꿈이 없다.
 */
class GeminiVideoRecordAnalyzerWireBytesTest {
    /** 한글, 따옴표, 빗금, 역빗금, 줄바꿈, 탭, 제어 문자, 이모지. */
    private static final String TRICKY = "따옴표\"와 빗금/와 역빗금\\ 줄\n탭\t제어\u001f 이모지😀";

    @TempDir
    Path directory;

    private final List<String> inputs = new ArrayList<>();
    private final List<String> schemas = new ArrayList<>();

    /** 받은 값을 적고 읽을 수 없는 답을 돌려준다. 분석은 실패하지만 첫 요청에 넘긴 값은 남는다. */
    private GeminiGateway gateway() {
        return new GeminiGateway() {
            @Override
            public GeminiFile upload(Path path, String mimeType) {
                return new GeminiFile("files/chunk", "https://files.test/chunk", mimeType, "ACTIVE");
            }

            @Override
            public GeminiFile get(String name) {
                throw new AssertionError("already active");
            }

            @Override
            public GenerateContentResponse generateResponse(String model, Content content, GenerateContentConfig config) {
                inputs.add(content.parts().orElseThrow().get(1).text().orElseThrow());
                schemas.add(config.responseSchema().orElseThrow().toJson());
                return GenerateContentResponse.builder()
                        .candidates(List.of(Candidate.builder().content(Content.fromParts(Part.fromText("읽을 수 없는 답"))).build()))
                        .build();
            }

            @Override
            public void delete(String name) {
            }
        };
    }

    private VideoRecordChunks chunks(boolean audio, Path chunk) {
        return new VideoRecordChunks() {
            @Override
            public boolean hasAudio(Path source) {
                return audio;
            }

            @Override
            public Path extract(Path source, long start, long end) {
                return chunk;
            }
        };
    }

    @Test
    @DisplayName("단어 시각이 있는 청크 입력은 정해진 키 순서와 정수 시각으로 쓰고, 응답 스키마도 정해진 JSON 이다")
    void chunkInputWithTranscriptAndSchema() throws Exception {
        Path chunk = Files.createFile(directory.resolve("chunk.mp4"));
        GeminiVideoRecordAnalyzer analyzer = new GeminiVideoRecordAnalyzer(gateway(), chunks(true, chunk), "test-model",
                new RecordingFailureReporter(), new RecordingLlmTelemetry());
        SpeechAnalysis speech = new SpeechAnalysis("안녕하세요", 4.5, List.of(), List.of(), List.of(
                new SpeechFacts.Word("안녕\"하세요\"/", 0.5, 2.0),
                new SpeechFacts.Word("😀", 2.25, 3.125)));

        assertThatThrownBy(() -> analyzer.analyze(directory.resolve("take.mp4"),
                new ActorMaterial(TRICKY, "오디션 지원자 \"민수\"", "담담하게/빠르지 않게", "그 외", "", 8000),
                UUID.fromString("00000000-0000-0000-0000-000000000001"), null, speech))
                .isInstanceOf(SummaryParseError.class);

        assertThat(inputs.getFirst()).isEqualTo(FrozenValue.of("wire-bytes/gemini-video-record-input.json"));
        assertThat(schemas.getFirst()).isEqualTo(FrozenValue.of("wire-bytes/gemini-video-record-schema.json"));
    }

    @Test
    @DisplayName("소리가 없고 단어 시각이 없는 청크 입력은 reference_transcript 를 null 로 싣는다")
    void chunkInputWithoutTranscript() throws Exception {
        Path chunk = Files.createFile(directory.resolve("chunk.mp4"));
        GeminiVideoRecordAnalyzer analyzer = new GeminiVideoRecordAnalyzer(gateway(), chunks(false, chunk), "test-model",
                new RecordingFailureReporter(), new RecordingLlmTelemetry());

        assertThatThrownBy(() -> analyzer.analyze(directory.resolve("take.mp4"),
                new ActorMaterial("", "", "", "그 외", "", 8000), UUID.fromString("00000000-0000-0000-0000-000000000002"),
                null, null))
                .isInstanceOf(SummaryParseError.class);

        assertThat(inputs.getFirst()).isEqualTo("""
                {"chunk_id":"chunk_0_8000","chunk_duration_ms":8000,"source_duration_ms":8000,"chunk_start_ms":0,\
                "chunk_end_ms":8000,"audio_track_present":false,"actor_context":{},"reference_transcript":null}""");
    }
}
