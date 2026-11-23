package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.platform.config.JacksonConfig;
import com.acttub.actingapi.platform.http.RestClients;
import com.acttub.actingapi.support.FrozenValue;
import tools.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/**
 * Langfuse 로 나가는 POST 세 가지(프롬프트 버전 만들기, 추적, 점수)의 본문을 바이트 그대로 고정한다. JSON 라이브러리를
 * 바꿔도 같은 바이트가 나가야 한다. 운영과 같은 ObjectMapper(앱 설정과 {@link JacksonConfig})로 만든다. 추적의 구간 ID 만
 * 매번 새로 만들므로 그 값은 모양만 본다. 추적 기대값은 {@code frozen/wire-bytes/langfuse-trace-*.json} 이고 마지막에
 * 줄바꿈이 없으며 구간 ID 자리에 {@code SPAN_ID} 가 있다.
 */
@JsonTest
@Import(JacksonConfig.class)
class LangfuseTelemetryWireBytesTest {
    /** 한글, 따옴표, 빗금, 역빗금, 줄바꿈, 탭, 제어 문자, 이모지. */
    private static final String TRICKY = "따옴표\"와 빗금/와 역빗금\\ 줄\n탭\t제어\u001f 이모지😀";
    private static final UUID PRACTICE = UUID.fromString("11112222-3333-4444-5555-666677778888");
    private static final UUID USER = UUID.fromString("99990000-1111-2222-3333-444455556666");
    private static final Instant STARTED = Instant.ofEpochSecond(1_700_000_000L, 123_456_789);
    private static final String HOST = "http://langfuse-web:3000";
    private static final Pattern SPAN_ID = Pattern.compile("\"spanId\":\"([0-9a-f]{16})\"");

    @Autowired
    ObjectMapper objectMapper;

    private final RestClient.Builder builder = RestClients.builder();
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    private final List<byte[]> sent = new ArrayList<>();

    private LangfuseTelemetry telemetry() {
        return new LangfuseTelemetry(objectMapper, Map.of(
                "LANGFUSE_HOST", HOST,
                "LANGFUSE_PUBLIC_KEY", "pk-not-real",
                "LANGFUSE_SECRET_KEY", "sk-not-real",
                "LANGFUSE_TRACING_ENVIRONMENT", "dev")::get, Runnable::run, builder::build);
    }

    private void expectPost(String path, String reply) {
        server.expect(requestTo(HOST + path)).andExpect(method(HttpMethod.POST))
                .andExpect(request -> sent.add(((MockClientHttpRequest) request).getBodyAsBytes()))
                .andRespond(withSuccess(reply, MediaType.APPLICATION_JSON));
    }

    private String body(int index) {
        return new String(sent.get(index), StandardCharsets.UTF_8);
    }

    /** 구간 ID 는 매번 새 값이다. 모양을 확인한 뒤 기대값의 자리 표시를 그 값으로 바꿔 나머지 바이트를 견준다. */
    private static String withSpanId(String expected, String actual) {
        Matcher matcher = SPAN_ID.matcher(actual);
        assertThat(matcher.find()).as("구간 ID 가 16진수 16자로 한 번 있다").isTrue();
        String spanId = matcher.group(1);
        assertThat(matcher.find()).isFalse();
        return expected.replace("\"spanId\":\"SPAN_ID\"", "\"spanId\":\"" + spanId + "\"");
    }

    @Test
    @DisplayName("처음 보는 프롬프트는 버전을 만들고, 그 버전을 단 추적과 실패한 추적을 정해진 바이트로 보낸다")
    void promptAndTraceBodies() {
        server.expect(requestTo(HOST + "/api/public/v2/prompts/coach.turn?label=dev")).andExpect(method(HttpMethod.GET))
                .andRespond(withStatus(HttpStatus.NOT_FOUND));
        expectPost("/api/public/v2/prompts", "{\"version\":3}");
        expectPost("/api/public/otel/v1/traces", "{}");
        expectPost("/api/public/otel/v1/traces", "{}");
        LangfuseTelemetry telemetry = telemetry();

        telemetry.record(new LlmCall(LlmStep.COACH_TURN, PRACTICE, USER, "gemini-3-flash-preview", TRICKY, "모델이 낸 말 \"좋아요\"",
                LlmTokens.of(9000, 30, 9030, 7000), STARTED, Duration.ofMillis(2500), null, Map.of("turn", "3"),
                new LlmPrompt("coach.turn", TRICKY), 0.000015666));
        telemetry.record(new LlmCall(LlmStep.OBSERVATION, PRACTICE, null, " ", "입력", "", LlmTokens.unknown(),
                STARTED, Duration.ofSeconds(90), "타임아웃 \"read\"/30s", Map.of(), null, 2.0));

        server.verify();
        assertThat(sent).hasSize(3);
        assertThat(body(0)).isEqualTo("""
                {"name":"coach.turn","type":"text","prompt":"따옴표\\"와 빗금/와 역빗금\\\\ 줄\\n탭\\t제어\\u001F 이모지😀",\
                "labels":["dev"]}""");
        assertThat(body(1)).isEqualTo(withSpanId(FrozenValue.of("wire-bytes/langfuse-trace-coach.json"), body(1)));
        assertThat(body(2)).isEqualTo(withSpanId(FrozenValue.of("wire-bytes/langfuse-trace-failed.json"), body(2)));
    }

    @Test
    @DisplayName("점수는 참거짓과 숫자를 소수로, 범주를 글로 싣고 설명이 있을 때만 comment 를 싣는다")
    void scoreBodies() {
        expectPost("/api/public/scores", "{}");
        expectPost("/api/public/scores", "{}");
        expectPost("/api/public/scores", "{}");
        LangfuseTelemetry telemetry = telemetry();

        telemetry.score(LlmScore.flag(PRACTICE, "coach.regenerated", true));
        telemetry.score(LlmScore.number(PRACTICE, "observation.count", 0.5));
        telemetry.score(LlmScore.category(PRACTICE, "note_rating", "좋음").withComment(TRICKY));

        server.verify();
        assertThat(body(0)).isEqualTo("""
                {"traceId":"11112222333344445555666677778888","name":"coach.regenerated","dataType":"BOOLEAN","value":1.0}""");
        assertThat(body(1)).isEqualTo("""
                {"traceId":"11112222333344445555666677778888","name":"observation.count","dataType":"NUMERIC","value":0.5}""");
        assertThat(body(2)).isEqualTo("""
                {"traceId":"11112222333344445555666677778888","name":"note_rating","dataType":"CATEGORICAL","value":"좋음",\
                "comment":"따옴표\\"와 빗금/와 역빗금\\\\ 줄\\n탭\\t제어\\u001F 이모지😀"}""");
    }
}
