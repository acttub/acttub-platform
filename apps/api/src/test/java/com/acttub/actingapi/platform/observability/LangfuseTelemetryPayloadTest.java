package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import com.acttub.actingapi.platform.json.LenientJson;

/** 값이 빈 자리는 싣지 않는다 — 모델 이름 없음, 일부만 아는 토큰, 사용자 없음, 점수 설명. */
class LangfuseTelemetryPayloadTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final UUID PRACTICE = UUID.fromString("11112222-3333-4444-5555-666677778888");

    private static LangfuseTelemetry telemetry() {
        return new LangfuseTelemetry(MAPPER, Map.of(
                "LANGFUSE_HOST", "http://langfuse-web:3000/",
                "LANGFUSE_PUBLIC_KEY", "pk",
                "LANGFUSE_SECRET_KEY", "sk")::get, Runnable::run);
    }

    private static Map<String, String> attributes(JsonNode payload) {
        Map<String, String> values = new LinkedHashMap<>();
        payload.path("resourceSpans").path(0).path("scopeSpans").path(0).path("spans").path(0).path("attributes")
                .forEach(entry -> values.put(LenientJson.asText(entry.path("key")), LenientJson.asText(entry.path("value").path("stringValue"))));
        return values;
    }

    @Test
    void blankModelUnknownUserAndPartlyKnownTokensLeaveThoseAttributesOut() {
        LlmCall call = new LlmCall(LlmStep.MEMORY_EXTRACTION, PRACTICE, null, " ", "입력", "",
                new LlmTokens(12, null, null), Instant.EPOCH, Duration.ofMillis(5), null, Map.of());

        Map<String, String> attributes = attributes(telemetry().tracePayload(call));

        assertThat(attributes).doesNotContainKeys("langfuse.user.id", "langfuse.observation.model.name",
                "gen_ai.request.model", "langfuse.observation.output");
        assertThat(attributes).containsEntry("langfuse.observation.usage_details", "{\"input\":12}");
        assertThat(attributes).containsEntry("langfuse.observation.input", "입력");
    }

    @Test
    void scoreCarriesItsCommentOnlyWhenThereIsOneAndNonNumbersAsText() {
        JsonNode commented = telemetry().scorePayload(new LlmScore(PRACTICE, "note_rating", "CATEGORICAL", "good", "짧은 메모"));
        JsonNode silent = telemetry().scorePayload(new LlmScore(PRACTICE, "note_rating", "NUMERIC", 4, " "));

        assertThat(LenientJson.asText(commented.path("comment"))).isEqualTo("짧은 메모");
        assertThat(LenientJson.asText(commented.path("value"))).isEqualTo("good");
        assertThat(silent.has("comment")).isFalse();
        assertThat(LenientJson.asDouble(silent.path("value"))).isEqualTo(4.0);
        assertThat(LenientJson.asText(silent.path("traceId"))).isEqualTo("11112222333344445555666677778888");
    }
}
