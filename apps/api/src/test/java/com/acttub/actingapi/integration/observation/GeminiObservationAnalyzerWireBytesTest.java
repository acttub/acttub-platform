package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;

import com.acttub.actingapi.support.FrozenValue;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.types.Candidate;
import com.google.genai.types.Content;
import com.google.genai.types.GenerateContentConfig;
import com.google.genai.types.GenerateContentResponse;
import com.google.genai.types.Part;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 관찰 요청에서 Gemini SDK 에 넘기는 응답 스키마를 고정한다. 우리 코드는 스키마 파일 글을 그대로 {@code Schema.fromJson} 에
 * 넘기므로 그 글에는 우리 JSON 라이브러리가 닿지 않는다. SDK 가 그 글을 읽어 만든 {@code Schema} 를 SDK 가 다시 쓴 JSON
 * 으로 본다. 기대값은 {@code frozen/wire-bytes/gemini-observation-schema.json} 이고 마지막에 줄바꿈이 없다.
 */
class GeminiObservationAnalyzerWireBytesTest {

    @Test
    @DisplayName("관찰 요청의 응답 스키마는 정해진 JSON 이다")
    void responseSchema() {
        List<String> schemas = new ArrayList<>();
        GeminiGateway gateway = new GeminiGateway() {
            @Override
            public GeminiFile upload(Path path, String mimeType) {
                return new GeminiFile("files/take", "https://files.test/take", mimeType, "ACTIVE");
            }

            @Override
            public GeminiFile get(String name) {
                throw new AssertionError("already active");
            }

            @Override
            public GenerateContentResponse generateResponse(String model, Content content, GenerateContentConfig config) {
                schemas.add(config.responseSchema().orElseThrow().toJson());
                return GenerateContentResponse.builder()
                        .candidates(List.of(Candidate.builder().content(Content.fromParts(Part.fromText("읽을 수 없는 답"))).build()))
                        .build();
            }

            @Override
            public void delete(String name) {
            }
        };
        GeminiObservationAnalyzer analyzer = new GeminiObservationAnalyzer(gateway, new ObjectMapper(), "test-model",
                new RecordingFailureReporter(), new RecordingLlmTelemetry());

        assertThatThrownBy(() -> analyzer.analyze(Path.of("take.mp4"), "video/mp4",
                new ActorMaterial("", "", "", "그 외", "", 8000), null, null))
                .isInstanceOf(SummaryParseError.class);

        assertThat(schemas).hasSize(GeminiObservationAnalyzer.PARSE_ATTEMPTS);
        assertThat(schemas.getFirst()).isEqualTo(FrozenValue.of("wire-bytes/gemini-observation-schema.json"));
    }
}
