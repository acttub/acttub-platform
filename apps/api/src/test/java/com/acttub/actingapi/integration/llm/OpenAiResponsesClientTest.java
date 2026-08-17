package com.acttub.actingapi.integration.llm;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.net.URI;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class OpenAiResponsesClientTest {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @Test
    void sendsExactGoldenRequestWithDefaultModel() throws Exception {
        StubTransport transport = new StubTransport(response(200, """
                {"output_text":"  답변  ","usage":{"input_tokens":11,"output_tokens":7,"total_tokens":18}}
                """));
        OpenAiResponsesClient client = client(transport, Map.of("OPENAI_API_KEY", "secret"));

        GeneratedText generated = client.generate("시스템", "입력 문자열");

        assertThat(generated).isEqualTo(new GeneratedText("답변", new TokenUsage(11, 7, 18)));
        OpenAiHttpRequest request = transport.requests.getFirst();
        assertThat(request.uri()).isEqualTo(URI.create("https://api.openai.com/v1/responses"));
        assertThat(request.headers()).containsExactly(
                Map.entry("Authorization", "Bearer secret"),
                Map.entry("Content-Type", "application/json"));
        assertThat(request.body().fieldNames()).toIterable()
                .containsExactly("model", "instructions", "input");
        assertThat(request.body()).isEqualTo(OBJECT_MAPPER.readTree("""
                {"model":"gpt-5.6-terra","instructions":"시스템","input":"입력 문자열"}
                """));
        assertThat(OpenAiResponsesClient.REQUEST_TIMEOUT).isEqualTo(Duration.ofSeconds(120));
    }

    @Test
    void readsFallbackOutputItemsAndRefusal() {
        StubTransport transport = new StubTransport(response(200, """
                {"output":[{"content":[
                  {"type":"output_text","text":" 첫째 "},
                  {"type":"ignored","text":"무시"},
                  {"type":"output_text","text":"둘째"}
                ]}]}
                """));
        assertThat(client(transport, Map.of("OPENAI_API_KEY", "k")).generate("s", "p").text())
                .isEqualTo("첫째 둘째");

        StubTransport refusal = new StubTransport(response(200, """
                {"output":[{"content":[{"type":"refusal","refusal":"정책상 거절"}]}]}
                """));
        assertThatThrownBy(() -> client(refusal, Map.of("OPENAI_API_KEY", "k")).generate("s", "p"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("OpenAI 평문 응답이 비었습니다 (정책상 거절).");
    }

    @Test
    void retriesOnly429And503FourTimesWithOneTwoFourSecondBackoff() {
        StubTransport transport = new StubTransport(
                response(429, "{}"), response(503, "{}"), response(429, "{}"),
                response(200, "{\"output_text\":\"성공\"}"));
        List<Duration> sleeps = new ArrayList<>();

        GeneratedText result = new OpenAiResponsesClient(
                OBJECT_MAPPER, transport, sleeps::add,
                name -> "OPENAI_API_KEY".equals(name) ? "k" : null).generate("s", "p");

        assertThat(result.text()).isEqualTo("성공");
        assertThat(transport.requests).hasSize(4);
        assertThat(sleeps).containsExactly(
                Duration.ofSeconds(1), Duration.ofSeconds(2), Duration.ofSeconds(4));
    }

    @Test
    void doesNotRetryOtherHttpStatusesAndUsesExactErrors() {
        StubTransport other = new StubTransport(response(500, "{}"));
        assertThatThrownBy(() -> client(other, Map.of("OPENAI_API_KEY", "k")).generate("s", "p"))
                .hasMessage("OpenAI 생성 실패: OpenAI가 HTTP 500로 응답했습니다.");
        assertThat(other.requests).hasSize(1);

        StubTransport busy = new StubTransport(
                response(429, "{}"), response(429, "{}"),
                response(429, "{}"), response(429, "{}"));
        assertThatThrownBy(() -> client(busy, Map.of("OPENAI_API_KEY", "k")).generate("s", "p"))
                .hasMessage("OpenAI 생성 실패: 지금 AI가 붐빕니다. 잠시 뒤 다시 시도해 주세요.");
        assertThat(busy.requests).hasSize(4);
    }

    @Test
    void retriesConnectionErrorsButPropagatesTheFourth() {
        StubTransport transport = new StubTransport(
                new IOException("one"), new IOException("two"),
                new IOException("three"), new IOException("four"));

        assertThatThrownBy(() -> client(transport, Map.of("OPENAI_API_KEY", "k")).generate("s", "p"))
                .isInstanceOf(OpenAiConnectionException.class)
                .hasCauseInstanceOf(IOException.class)
                .hasRootCauseMessage("four");
        assertThat(transport.requests).hasSize(4);
    }

    @Test
    void readsConfigurationAtCallTimeAndDoesNotRequireKeyAtBoot() {
        StubTransport transport = new StubTransport(response(200, "{\"output_text\":\"ok\"}"));
        OpenAiResponsesClient client = client(transport, Map.of());

        assertThatThrownBy(() -> client.generate("s", "p"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("OpenAI 호출에는 OPENAI_API_KEY 환경변수가 필요합니다.");
        assertThat(transport.requests).isEmpty();
    }

    @Test
    void keyAndModelAreResolvedWhenGenerateIsCalled() {
        StubTransport transport = new StubTransport(response(200, "{\"output_text\":\"ok\"}"));
        AtomicReference<String> key = new AtomicReference<>();
        AtomicReference<String> model = new AtomicReference<>();
        OpenAiResponsesClient client = new OpenAiResponsesClient(
                OBJECT_MAPPER,
                transport,
                duration -> {},
                name -> "OPENAI_API_KEY".equals(name) ? key.get() : model.get());
        key.set("late-key");
        model.set("custom-model");

        client.generate("s", "p");

        assertThat(transport.requests.getFirst().body().path("model").asText())
                .isEqualTo("custom-model");
    }

    private static OpenAiResponsesClient client(
            StubTransport transport, Map<String, String> environment) {
        return new OpenAiResponsesClient(
                OBJECT_MAPPER, transport, duration -> {}, environment::get);
    }

    private static OpenAiHttpResponse response(int status, String body) {
        return new OpenAiHttpResponse(status, body);
    }

    private static final class StubTransport implements OpenAiHttpTransport {
        private final Deque<Object> results = new ArrayDeque<>();
        private final List<OpenAiHttpRequest> requests = new ArrayList<>();

        StubTransport(Object... results) {
            this.results.addAll(List.of(results));
        }

        @Override
        public OpenAiHttpResponse exchange(OpenAiHttpRequest request) throws IOException {
            requests.add(request);
            Object result = results.removeFirst();
            if (result instanceof IOException exception) {
                throw exception;
            }
            return (OpenAiHttpResponse) result;
        }
    }
}
