package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Executor;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 보내는 모양을 못박는다.
 *
 * <p>OTLP 는 형태가 틀리면 <b>조용히 버려진다</b> — 서버가 200 을 주고 화면에는 아무것도
 * 안 뜬다. 그래서 여기서 잡지 못하면 운영에 올린 뒤에야 안 들어온다는 것을 알게 되고,
 * 그때는 무엇이 틀렸는지 볼 단서가 없다.
 */
class LangfuseTelemetryTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final UUID PRACTICE = UUID.fromString("11112222-3333-4444-5555-666677778888");
    private static final UUID USER = UUID.fromString("99990000-1111-2222-3333-444455556666");
    private static final Instant STARTED = Instant.ofEpochSecond(1_700_000_000L, 123_456_789);

    /** 추적 ID 는 연습 세션 UUID 그대로다 — 이 값이 흩어진 호출을 한 기록으로 모은다. */
    @Test
    @DisplayName("추적 ID 는 연습 세션 UUID 의 16진수 32자다")
    void traceIdIsThePracticeSessionUuid() {
        assertThat(LangfuseTelemetry.traceId(PRACTICE))
                .isEqualTo("11112222333344445555666677778888")
                .hasSize(32);
    }

    @Test
    @DisplayName("호출 하나가 OTLP 한 건으로 조립된다")
    void callBecomesOneOtlpSpan() throws Exception {
        JsonNode payload = telemetry(Map.of(
                "LANGFUSE_HOST", "http://langfuse-web:3000",
                "LANGFUSE_PUBLIC_KEY", "pk",
                "LANGFUSE_SECRET_KEY", "sk"))
                .tracePayload(call(LlmStep.COACH_TURN, null));

        JsonNode span = payload.path("resourceSpans").path(0)
                .path("scopeSpans").path(0).path("spans").path(0);

        assertThat(span.path("traceId").asText()).isEqualTo("11112222333344445555666677778888");
        assertThat(span.path("spanId").asText()).hasSize(16);
        assertThat(span.path("name").asText()).isEqualTo("coach.turn");
        // 나노초 시각은 64비트라 문자열이어야 한다 — 숫자로 실으면 큰 값이 깨진다.
        assertThat(span.path("startTimeUnixNano").isTextual()).isTrue();
        assertThat(span.path("startTimeUnixNano").asText()).isEqualTo("1700000000123456789");
        assertThat(span.path("endTimeUnixNano").asText()).isEqualTo("1700000002123456789");
        assertThat(span.path("status").path("code").asInt()).isEqualTo(1);

        Map<String, String> attributes = attributes(span);
        assertThat(attributes)
                .containsEntry("langfuse.session.id", PRACTICE.toString())
                .containsEntry("langfuse.user.id", USER.toString())
                .containsEntry("langfuse.observation.type", "generation")
                .containsEntry("langfuse.observation.model.name", "gpt-5.6-luna")
                .containsEntry("gen_ai.request.model", "gpt-5.6-luna")
                .containsEntry("langfuse.observation.input", "시스템\n입력")
                .containsEntry("langfuse.observation.output", "모델이 낸 말")
                .containsEntry("langfuse.observation.metadata.step", "COACH_TURN")
                .containsEntry("langfuse.observation.metadata.turn", "3");
        assertThat(MAPPER.readTree(attributes.get("langfuse.observation.usage_details")))
                .isEqualTo(MAPPER.readTree("{\"input\":11,\"output\":22,\"total\":33}"));
    }

    /** 실패한 호출도 같은 모양으로 남는다 — 실패만 사라지면 비율을 셀 수 없다. */
    @Test
    @DisplayName("실패한 호출은 ERROR 상태로 남는다")
    void failedCallCarriesErrorStatus() {
        JsonNode span = telemetry(enabledEnvironment())
                .tracePayload(call(LlmStep.OBSERVATION, "타임아웃"))
                .path("resourceSpans").path(0).path("scopeSpans").path(0).path("spans").path(0);

        assertThat(span.path("status").path("code").asInt()).isEqualTo(2);
        assertThat(span.path("status").path("message").asText()).isEqualTo("타임아웃");
        assertThat(attributes(span)).containsEntry("langfuse.observation.level", "ERROR");
    }

    /** 값이 없는 칸은 속성을 만들지 않는다 — 빈 속성은 화면에서 빈 줄로 남는다. */
    @Test
    @DisplayName("토큰을 모르면 사용량 속성을 만들지 않는다")
    void unknownTokensProduceNoUsageAttribute() {
        LlmCall call = new LlmCall(
                LlmStep.TRANSCRIPTION, PRACTICE, null, "gemini-3.5-transcribe",
                "입력", "출력", LlmTokens.unknown(), STARTED, Duration.ofMillis(10), null, Map.of());

        Map<String, String> attributes = attributes(telemetry(enabledEnvironment())
                .tracePayload(call)
                .path("resourceSpans").path(0).path("scopeSpans").path(0).path("spans").path(0));

        assertThat(attributes).doesNotContainKey("langfuse.observation.usage_details");
        assertThat(attributes).doesNotContainKey("langfuse.user.id");
    }

    @Test
    @DisplayName("점수는 같은 추적 ID 에 붙는다")
    void scoreAttachesToTheSameTrace() {
        LangfuseTelemetry telemetry = telemetry(enabledEnvironment());

        JsonNode flag = telemetry.scorePayload(
                LlmScore.flag(PRACTICE, "coach.fallback_used", true));
        assertThat(flag.path("traceId").asText()).isEqualTo("11112222333344445555666677778888");
        assertThat(flag.path("name").asText()).isEqualTo("coach.fallback_used");
        assertThat(flag.path("dataType").asText()).isEqualTo("BOOLEAN");
        assertThat(flag.path("value").asDouble()).isEqualTo(1.0);

        JsonNode category = telemetry.scorePayload(
                LlmScore.category(PRACTICE, "coach.validation_failure", "forbidden_language"));
        assertThat(category.path("dataType").asText()).isEqualTo("CATEGORICAL");
        assertThat(category.path("value").asText()).isEqualTo("forbidden_language");

        JsonNode number = telemetry.scorePayload(LlmScore.number(PRACTICE, "observation.count", 7));
        assertThat(number.path("dataType").asText()).isEqualTo("NUMERIC");
        assertThat(number.path("value").asDouble()).isEqualTo(7.0);
    }

    /** 설정이 비면 통째로 꺼진다 — 로컬·시험에서 관측 없이 도는 것이 정상이다. */
    @Test
    @DisplayName("설정이 비면 아무것도 보내지 않는다")
    void missingConfigurationDisablesEverything() {
        List<Runnable> submitted = new ArrayList<>();
        LangfuseTelemetry telemetry = new LangfuseTelemetry(MAPPER, Map.<String, String>of()::get, submitted::add);

        telemetry.record(call(LlmStep.REPORT, null));
        telemetry.score(LlmScore.flag(PRACTICE, "coach.regenerated", true));

        assertThat(telemetry.isEnabled()).isFalse();
        assertThat(submitted).isEmpty();
    }

    /** 키만 빠져도 꺼진다 — 반쯤 켜진 채로 인증 실패를 반복하지 않는다. */
    @Test
    @DisplayName("주소만 있고 키가 없으면 꺼진다")
    void hostWithoutKeysIsDisabled() {
        assertThat(telemetry(Map.of("LANGFUSE_HOST", "http://langfuse-web:3000")).isEnabled())
                .isFalse();
    }

    /** 큐가 차면 버린다. 관측을 잃는 것이 배우를 기다리게 하는 것보다 낫다. */
    @Test
    @DisplayName("보내는 쪽이 거절하면 삼키고 버린 수를 센다")
    void rejectedSendsAreDroppedNotThrown() {
        Executor rejecting = runnable -> {
            throw new java.util.concurrent.RejectedExecutionException("큐가 찼다");
        };
        LangfuseTelemetry telemetry =
                new LangfuseTelemetry(MAPPER, enabledEnvironment()::get, rejecting);

        telemetry.record(call(LlmStep.MEMORY_EXTRACTION, null));
        telemetry.score(LlmScore.number(PRACTICE, "observation.chars", 1200));

        assertThat(telemetry.droppedCount()).isEqualTo(2);
    }

    private static LangfuseTelemetry telemetry(Map<String, String> environment) {
        return new LangfuseTelemetry(MAPPER, environment::get, Runnable::run);
    }

    private static Map<String, String> enabledEnvironment() {
        return Map.of(
                "LANGFUSE_HOST", "http://langfuse-web:3000",
                "LANGFUSE_PUBLIC_KEY", "pk",
                "LANGFUSE_SECRET_KEY", "sk");
    }

    private static LlmCall call(LlmStep step, String errorMessage) {
        return new LlmCall(
                step,
                PRACTICE,
                USER,
                "gpt-5.6-luna",
                "시스템\n입력",
                "모델이 낸 말",
                LlmTokens.of(11, 22, 33),
                STARTED,
                Duration.ofSeconds(2),
                errorMessage,
                LlmCall.metadata("turn", "3", "blockage", null));
    }

    private static Map<String, String> attributes(JsonNode span) {
        Map<String, String> values = new java.util.LinkedHashMap<>();
        span.path("attributes").forEach(entry ->
                values.put(entry.path("key").asText(),
                        entry.path("value").path("stringValue").asText()));
        return values;
    }
}
