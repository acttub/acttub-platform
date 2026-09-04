package com.acttub.actingapi.integration.llm;

import java.io.IOException;
import java.net.URI;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** Python {@code acting_llm.openai_client.generate_text}의 Responses REST 동형 이식. */
@Component
public class OpenAiResponsesClient implements TextGenerator {

    static final Duration REQUEST_TIMEOUT = Duration.ofSeconds(120);
    private static final URI RESPONSES_URI =
            URI.create("https://api.openai.com/v1/responses");
    private static final int ATTEMPTS = 4;
    private static final Set<Integer> RETRY_STATUSES = Set.of(429, 503);
    /**
     * 환경변수가 비었을 때 쓰는 모델. 코치가 보는 것이 관찰 팩 전문이 된 뒤로(SOMA-490)
     * 긴 근거를 읽고 한 가지를 골라 묻는 일이 이 층의 전부라, terra 대신 luna 를 기본으로 둔다.
     *
     * <p>⚠ 두 서버의 {@code api.env} 는 {@code OPENAI_CHAT_MODEL} 을 직접 적어 두고 있고
     * 환경변수가 이 기본값을 이긴다 — 배포만으로는 모델이 바뀌지 않는다.
     */
    private static final String DEFAULT_MODEL = "gpt-5.6-luna";

    private final ObjectMapper objectMapper;
    private final OpenAiHttpTransport transport;
    private final Sleeper sleeper;
    private final Function<String, String> environment;

    @Autowired
    public OpenAiResponsesClient(ObjectMapper objectMapper) {
        this(
                objectMapper,
                new RestClientOpenAiTransport(REQUEST_TIMEOUT),
                Sleeper.real(),
                System::getenv);
    }

    OpenAiResponsesClient(
            ObjectMapper objectMapper,
            OpenAiHttpTransport transport,
            Sleeper sleeper,
            Function<String, String> environment) {
        this.objectMapper = objectMapper;
        this.transport = transport;
        this.sleeper = sleeper;
        this.environment = environment;
    }

    @Override
    public GeneratedText generate(String instructions, String input) {
        Configuration configuration = requiredConfiguration();
        ObjectNode body = objectMapper.createObjectNode();
        body.put("model", configuration.model());
        body.put("instructions", instructions);
        body.put("input", input);

        Map<String, String> headers = new LinkedHashMap<>();
        headers.put("Authorization", "Bearer " + configuration.apiKey());
        headers.put("Content-Type", "application/json");
        OpenAiHttpResponse response = retryingRequest(
                new OpenAiHttpRequest(RESPONSES_URI, headers, body));
        if (response.status() < 200 || response.status() >= 300) {
            throw apiError(response.status(), "OpenAI 생성 실패");
        }

        JsonNode payload;
        try {
            payload = objectMapper.readTree(response.body());
        } catch (JsonProcessingException exc) {
            throw new IllegalStateException("OpenAI 평문 응답을 읽지 못했습니다.", exc);
        }
        if (payload == null || !payload.isObject()) {
            throw new IllegalStateException("OpenAI 평문 응답을 읽지 못했습니다.");
        }

        List<JsonNode> contents = outputItems(payload);
        JsonNode direct = payload.get("output_text");
        String text = direct != null && direct.isTextual()
                ? direct.textValue().strip()
                : contents.stream()
                        .filter(content -> "output_text".equals(content.path("type").asText()))
                        .map(content -> content.path("text"))
                        .filter(JsonNode::isTextual)
                        .map(JsonNode::textValue)
                        .reduce("", String::concat)
                        .strip();
        if (text.isEmpty()) {
            String refusal = contents.stream()
                    .map(content -> content.get("refusal"))
                    .filter(value -> value != null && value.isTextual() && !value.textValue().isEmpty())
                    .map(JsonNode::textValue)
                    .reduce((left, right) -> left + " " + right)
                    .orElse("");
            String detail = refusal.isEmpty() ? "" : " (" + refusal + ")";
            throw new IllegalStateException("OpenAI 평문 응답이 비었습니다" + detail + ".");
        }
        return new GeneratedText(text, tokenUsage(payload));
    }

    private OpenAiHttpResponse retryingRequest(OpenAiHttpRequest request) {
        Duration delay = Duration.ofSeconds(1);
        for (int attempt = 0; attempt < ATTEMPTS; attempt++) {
            OpenAiHttpResponse response = null;
            try {
                response = transport.exchange(request);
            } catch (IOException exc) {
                if (attempt == ATTEMPTS - 1) {
                    throw new OpenAiConnectionException(exc);
                }
            }
            if (response != null && !RETRY_STATUSES.contains(response.status())) {
                return response;
            }
            if (response != null && attempt == ATTEMPTS - 1) {
                return response;
            }
            sleeper.sleep(delay);
            delay = delay.multipliedBy(2);
        }
        throw new IllegalStateException("OpenAI 요청을 완료하지 못했습니다.");
    }

    private Configuration requiredConfiguration() {
        String key = value("OPENAI_API_KEY");
        if (key.isEmpty()) {
            throw new IllegalStateException("OpenAI 호출에는 OPENAI_API_KEY 환경변수가 필요합니다.");
        }
        String configuredModel = value("OPENAI_CHAT_MODEL");
        return new Configuration(key, configuredModel.isEmpty() ? DEFAULT_MODEL : configuredModel);
    }

    private String value(String name) {
        String value = environment.apply(name);
        return value == null ? "" : value.strip();
    }

    private static IllegalStateException apiError(int status, String context) {
        if (RETRY_STATUSES.contains(status)) {
            return new IllegalStateException(
                    context + ": 지금 AI가 붐빕니다. 잠시 뒤 다시 시도해 주세요.");
        }
        return new IllegalStateException(
                context + ": OpenAI가 HTTP " + status + "로 응답했습니다.");
    }

    private static List<JsonNode> outputItems(JsonNode payload) {
        JsonNode output = payload.get("output");
        if (output == null || !output.isArray()) {
            return List.of();
        }
        return java.util.stream.StreamSupport.stream(output.spliterator(), false)
                .filter(JsonNode::isObject)
                .map(item -> item.get("content"))
                .filter(content -> content != null && content.isArray())
                .flatMap(content -> java.util.stream.StreamSupport.stream(content.spliterator(), false))
                .filter(JsonNode::isObject)
                .toList();
    }

    private static TokenUsage tokenUsage(JsonNode payload) {
        JsonNode usage = payload.get("usage");
        int prompt = integer(usage, "input_tokens");
        int completion = integer(usage, "output_tokens");
        JsonNode totalNode = usage == null ? null : usage.get("total_tokens");
        int total = totalNode != null && totalNode.isIntegralNumber()
                ? totalNode.intValue()
                : prompt + completion;
        return new TokenUsage(prompt, completion, total);
    }

    private static int integer(JsonNode parent, String field) {
        if (parent == null || !parent.isObject()) {
            return 0;
        }
        JsonNode value = parent.get(field);
        return value != null && value.isIntegralNumber() ? value.intValue() : 0;
    }

    private record Configuration(String apiKey, String model) {
    }

    @FunctionalInterface
    interface Sleeper {
        void sleep(Duration duration);

        static Sleeper real() {
            return duration -> {
                try {
                    Thread.sleep(duration);
                } catch (InterruptedException exc) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("OpenAI 재시도 대기가 중단됐습니다.", exc);
                }
            };
        }
    }
}
