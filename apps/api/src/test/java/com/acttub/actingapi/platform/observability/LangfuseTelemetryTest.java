package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.headerDoesNotExist;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withException;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.io.IOException;
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
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/**
 * 보내는 모양을 못박는다.
 *
 * <p>OTLP 는 형태가 틀리면 <b>조용히 버려진다</b> — 서버가 200 을 주고 화면에는 아무것도
 * 안 뜬다. 그래서 여기서 잡지 못하면 운영에 올린 뒤에야 안 들어온다는 것을 알게 되고,
 * 그때는 무엇이 틀렸는지 볼 단서가 없다.
 */
@ExtendWith(OutputCaptureExtension.class)
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

    /**
     * 관측 서버는 같은 호스트 안의 평문 주소다. HTTP/2 업그레이드를 시도하면 서버가 응답 없이
     * 끊어 기록이 전부 버려졌다(dev 실측, 2026-09-13) — 전송 코드는 멀쩡히 돌면서.
     */
    @Test
    @DisplayName("관측 전송은 HTTP/1.1 로 고정한다")
    void sendsOverHttp11() {
        assertThat(LangfuseTelemetry.httpClient().version())
                .isEqualTo(java.net.http.HttpClient.Version.HTTP_1_1);
    }

    @Test
    @DisplayName("HTTP 요청은 v4 헤더와 Basic 인증을 싣고 전송은 일꾼이 맡는다")
    void sendsV4TraceAndScoresOnlyWhenTheWorkerRuns() {
        var builder = RestClient.builder();
        var server = MockRestServiceServer.bindTo(builder).build();
        List<Runnable> submitted = new ArrayList<>();
        var telemetry = new LangfuseTelemetry(MAPPER, enabledEnvironment()::get,
                submitted::add, builder::build);
        server.expect(requestTo("http://langfuse-web:3000/api/public/otel/v1/traces"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", "Basic cGs6c2s="))
                .andExpect(header("x-langfuse-ingestion-version", "4"))
                .andExpect(content().contentType(MediaType.APPLICATION_JSON))
                .andExpect(jsonPath("$.resourceSpans[0].scopeSpans[0].spans[0].traceId")
                        .value("11112222333344445555666677778888"))
                .andExpect(jsonPath("$.resourceSpans[0].scopeSpans[0].spans[0].name").value("coach.turn"))
                .andRespond(withSuccess("{}", MediaType.APPLICATION_JSON));
        server.expect(requestTo("http://langfuse-web:3000/api/public/scores"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", "Basic cGs6c2s="))
                .andExpect(headerDoesNotExist("x-langfuse-ingestion-version"))
                .andExpect(content().json("""
                        {"traceId":"11112222333344445555666677778888",
                         "name":"coach.regenerated","dataType":"BOOLEAN","value":1.0}
                        """))
                .andRespond(withSuccess());

        telemetry.record(call(LlmStep.COACH_TURN, null));
        telemetry.score(LlmScore.flag(PRACTICE, "coach.regenerated", true));

        assertThat(submitted).hasSize(2);
        submitted.forEach(Runnable::run);
        server.verify();
    }

    @Test
    @DisplayName("HTTP 오류와 연결 실패는 삼키고 응답 본문과 예외 메시지를 로그에 싣지 않는다")
    void transportFailuresNeverExposeResponseOrExceptionText(CapturedOutput output) {
        var builder = RestClient.builder();
        var server = MockRestServiceServer.bindTo(builder).build();
        var telemetry = new LangfuseTelemetry(MAPPER, enabledEnvironment()::get,
                Runnable::run, builder::build);
        server.expect(requestTo("http://langfuse-web:3000/api/public/otel/v1/traces"))
                .andRespond(withServerError().body("응답에 섞인 민감값 표식"));
        server.expect(requestTo("http://langfuse-web:3000/api/public/scores"))
                .andRespond(withException(new IOException("예외에 섞인 민감값 표식")));

        assertThatCode(() -> telemetry.record(call(LlmStep.COACH_TURN, null))).doesNotThrowAnyException();
        assertThatCode(() -> telemetry.score(LlmScore.number(PRACTICE, "observation.count", 1)))
                .doesNotThrowAnyException();

        server.verify();
        assertThat(output.getAll()).contains("LLM 관측 전송 실패")
                .doesNotContain("응답에 섞인 민감값 표식", "예외에 섞인 민감값 표식", "Basic cGs6c2s=");
    }

    @Test
    @DisplayName("비동기 조립 실패를 삼킨 뒤에도 다음 관측을 처리한다")
    void serializationFailureCannotEscapeTheWorker() {
        List<Runnable> submitted = new ArrayList<>();
        var builder = RestClient.builder();
        var server = MockRestServiceServer.bindTo(builder).build();
        var telemetry = new LangfuseTelemetry(MAPPER, enabledEnvironment()::get, submitted::add, builder::build);
        server.expect(requestTo("http://langfuse-web:3000/api/public/scores")).andRespond(withSuccess());
        telemetry.record(new LlmCall(LlmStep.REPORT, PRACTICE, USER, "model", "입력", "출력",
                null, STARTED, Duration.ofSeconds(Long.MAX_VALUE), null, Map.of()));
        telemetry.score(LlmScore.number(PRACTICE, "observation.count", 1));

        assertThat(submitted).hasSize(2);
        assertThatCode(() -> submitted.forEach(Runnable::run)).doesNotThrowAnyException();
        server.verify();
    }

    @Test
    @DisplayName("설정 중 하나라도 비면 HTTP 클라이언트도 만들지 않는다")
    void partialConfigurationDoesNotCreateAClientOrSubmitWork() {
        for (String key : enabledEnvironment().keySet()) {
            var environment = new java.util.HashMap<>(enabledEnvironment());
            environment.put(key, " \t ");
            var telemetry = new LangfuseTelemetry(MAPPER, environment::get,
                    task -> { throw new AssertionError("꺼진 관측은 일을 맡기지 않는다"); },
                    () -> { throw new AssertionError("꺼진 관측은 클라이언트를 만들지 않는다"); });
            telemetry.record(call(LlmStep.REPORT, null));
            telemetry.score(LlmScore.flag(PRACTICE, "coach.regenerated", false));
            assertThat(telemetry.isEnabled()).isFalse();
        }
    }

    @Test
    @DisplayName("연습 세션이 없으면 호출과 점수를 조립하거나 전송하지 않는다")
    void nullPracticeDoesNotSubmitCallsOrScores() {
        var telemetry = new LangfuseTelemetry(MAPPER, enabledEnvironment()::get,
                task -> { throw new AssertionError("연습을 모르면 일을 맡기지 않는다"); });
        telemetry.record(new LlmCall(LlmStep.REPORT, null, USER, "model", "입력", "출력",
                null, STARTED, Duration.ZERO, null, Map.of()));
        telemetry.score(LlmScore.flag(null, "coach.regenerated", false));
    }

    @Test
    @DisplayName("실행 환경을 정하면 기록 전체에 그 이름이 붙는다")
    void tracingEnvironmentIsAttachedToTheResource() {
        JsonNode resource = resource(telemetry(environmentWith("production"))
                .tracePayload(call(LlmStep.COACH_TURN, null)));

        assertThat(attributes(resource))
                .containsEntry("service.name", "acttub-api")
                .containsEntry("langfuse.environment", "production");
    }

    @Test
    @DisplayName("실행 환경을 안 정하면 환경 속성을 만들지 않는다")
    void missingTracingEnvironmentLeavesTheResourceAlone() {
        JsonNode resource = resource(telemetry(enabledEnvironment())
                .tracePayload(call(LlmStep.COACH_TURN, null)));

        assertThat(attributes(resource)).containsOnlyKeys("service.name");
    }

    /**
     * 규칙에 안 맞는 이름을 그대로 실으면 수집 자체가 거절당해 기록이 통째로 사라진다.
     * 환경 구분을 잃는 것보다 낫지 않으므로, 틀린 값은 버리고 기본 환경으로 보낸다.
     */
    @Test
    @DisplayName("규칙에 안 맞는 환경 이름은 버리고 기록은 그대로 보낸다")
    void invalidTracingEnvironmentIsDroppedWithoutBreakingTheTrace() {
        List<String> invalid = List.of(
                "Production",      // 대문자
                "prod env",        // 공백
                "prod!",           // 기호
                "langfuse-prod",   // langfuse 로 시작
                "a".repeat(41));   // 40자 초과

        for (String value : invalid) {
            JsonNode payload = telemetry(environmentWith(value))
                    .tracePayload(call(LlmStep.COACH_TURN, null));

            assertThat(attributes(resource(payload))).as(value).containsOnlyKeys("service.name");
            assertThat(payload.path("resourceSpans").path(0).path("scopeSpans").path(0)
                    .path("spans").path(0).path("traceId").asText()).as(value)
                    .isEqualTo("11112222333344445555666677778888");
        }
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

    private static Map<String, String> environmentWith(String tracingEnvironment) {
        Map<String, String> values = new java.util.LinkedHashMap<>(enabledEnvironment());
        values.put("LANGFUSE_TRACING_ENVIRONMENT", tracingEnvironment);
        return values;
    }

    private static JsonNode resource(JsonNode payload) {
        return payload.path("resourceSpans").path(0).path("resource");
    }

    private static Map<String, String> attributes(JsonNode span) {
        Map<String, String> values = new java.util.LinkedHashMap<>();
        span.path("attributes").forEach(entry ->
                values.put(entry.path("key").asText(),
                        entry.path("value").path("stringValue").asText()));
        return values;
    }
}
