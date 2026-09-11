package com.acttub.actingapi.platform.observability;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.Executor;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Function;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * {@link LlmTelemetry} 의 Langfuse 구현. 자체 호스팅한 관측 서버로 보낸다.
 *
 * <p><b>왜 SDK 를 안 쓰나</b> — Langfuse 에는 추적을 보내는 Java SDK 가 없고, 공식 경로가
 * OpenTelemetry 로 {@code /api/public/otel/v1/traces} 에 보내는 것이다. 그런데 우리 호출
 * 지점은 여섯이고 전부 우리가 직접 REST 로 부르는 자리라 자동 계측이 잡아 줄 것이 없다 —
 * SDK 를 넣어도 기록은 손으로 만든다. 그래서 의존성을 늘리지 않고 OTLP 의 JSON 을 직접
 * 조립해 보낸다. 형태가 틀리면 조용히 안 들어가므로 {@code LangfuseTelemetryTest} 가
 * 그 형태를 고정한다.
 *
 * <p><b>기록을 묶는 방법</b> — OTLP 의 추적 ID 는 16바이트이고 UUID 도 정확히 16바이트다.
 * 연습 세션 UUID 를 그대로 추적 ID 로 쓴다. 그러면 워커에서 도는 관찰과 요청에서 도는
 * 코치 턴이 며칠 떨어져 있어도 같은 기록에 모인다 — 호출 맥락을 코드로 실어 나를 필요가
 * 없다.
 *
 * <p><b>절대 막지 않는다</b> — 전송은 작은 스레드 풀에 맡기고 큐가 차면 버린다. 관측을
 * 잃는 것이 배우를 기다리게 하는 것보다 낫다. 던지지도 않는다(Port 계약).
 */
@Component
public class LangfuseTelemetry implements LlmTelemetry {

    private static final Logger LOG = LoggerFactory.getLogger(LangfuseTelemetry.class);
    private static final Duration TIMEOUT = Duration.ofSeconds(5);

    /** 큐 길이. 넘치면 버린다 — 관측이 밀렸다고 메모리를 먹으면 안 된다. */
    private static final int QUEUE_CAPACITY = 500;

    /** 버린 것을 매번 찍으면 로그가 그것으로 덮인다. 이 수마다 한 번만 알린다. */
    private static final long DROP_LOG_INTERVAL = 100;

    private final String host;
    private final String authorization;
    private final boolean enabled;
    private final RestClient client;
    private final ObjectMapper mapper;
    private final Executor sender;
    private final AtomicLong dropped = new AtomicLong();

    @Autowired
    public LangfuseTelemetry(ObjectMapper mapper) {
        this(mapper, System::getenv, defaultSender());
    }

    LangfuseTelemetry(ObjectMapper mapper, Function<String, String> environment, Executor sender) {
        this.mapper = mapper;
        this.sender = sender;
        String configuredHost = value(environment, "LANGFUSE_HOST");
        String publicKey = value(environment, "LANGFUSE_PUBLIC_KEY");
        String secretKey = value(environment, "LANGFUSE_SECRET_KEY");
        this.host = trimTrailingSlash(configuredHost);
        this.enabled = !host.isEmpty() && !publicKey.isEmpty() && !secretKey.isEmpty();
        this.authorization = enabled ? basic(publicKey, secretKey) : "";
        this.client = RestClient.builder()
                .requestFactory(timeoutFactory())
                .build();
        if (!enabled) {
            // 설정이 비면 통째로 꺼진다. dev 나 로컬에서 관측 없이 돌리는 정상 상태이므로
            // 경고가 아니라 알림으로 남긴다.
            LOG.info("LLM 관측이 꺼져 있다 (LANGFUSE_HOST·키가 비었다)");
        }
    }

    @Override
    public void record(LlmCall call) {
        if (!enabled || call == null) {
            return;
        }
        submit(() -> post("/api/public/otel/v1/traces", tracePayload(call)), "record");
    }

    @Override
    public void score(LlmScore score) {
        if (!enabled || score == null) {
            return;
        }
        submit(() -> post("/api/public/scores", scorePayload(score)), "score");
    }

    // --- 보내기 -------------------------------------------------------------

    private void submit(Runnable task, String what) {
        try {
            sender.execute(task);
        } catch (RuntimeException rejected) {
            long count = dropped.incrementAndGet();
            if (count % DROP_LOG_INTERVAL == 1) {
                LOG.warn("LLM 관측 전송을 버렸다 ({}), 누적 {}건", what, count);
            }
        }
    }

    private void post(String path, JsonNode body) {
        try {
            client.post()
                    .uri(host + path)
                    .header("Authorization", authorization)
                    .header("Content-Type", "application/json")
                    .body(mapper.writeValueAsString(body))
                    .retrieve()
                    .toBodilessEntity();
        } catch (Exception failure) {
            // 관측이 죽어서 연습이 멈추면 앞뒤가 바뀐다. 삼키고 남긴다.
            LOG.warn("LLM 관측 전송 실패 ({}): {}", path, failure.getMessage());
        }
    }

    // --- OTLP 조립 ----------------------------------------------------------

    /**
     * OTLP/JSON 한 건. 바이트 필드(추적 ID·구간 ID)는 이 형식에서 16진수 문자열이고,
     * 나노초 시각은 64비트라 문자열로 싣는다 — 숫자로 실으면 큰 값이 깨진다.
     */
    JsonNode tracePayload(LlmCall call) {
        ObjectNode span = mapper.createObjectNode();
        span.put("traceId", traceId(call.practiceSessionId()));
        span.put("spanId", randomSpanId());
        span.put("name", call.step().spanName());
        span.put("kind", 3); // CLIENT
        long startNanos = call.startedAt().getEpochSecond() * 1_000_000_000L
                + call.startedAt().getNano();
        span.put("startTimeUnixNano", Long.toString(startNanos));
        span.put("endTimeUnixNano", Long.toString(startNanos + call.took().toNanos()));

        ArrayNode attributes = span.putArray("attributes");
        attribute(attributes, "langfuse.trace.name", "practice");
        attribute(attributes, "langfuse.session.id", call.practiceSessionId().toString());
        if (call.userId() != null) {
            attribute(attributes, "langfuse.user.id", call.userId().toString());
        }
        attribute(attributes, "langfuse.observation.type", "generation");
        attribute(attributes, "langfuse.observation.input", call.input());
        attribute(attributes, "langfuse.observation.output", call.output());
        if (call.model() != null && !call.model().isBlank()) {
            attribute(attributes, "langfuse.observation.model.name", call.model());
            attribute(attributes, "gen_ai.request.model", call.model());
        }
        if (!call.tokens().isUnknown()) {
            attribute(attributes, "langfuse.observation.usage_details", usage(call.tokens()));
        }
        attribute(attributes, "langfuse.observation.metadata.step", call.step().name());
        call.metadata().forEach((key, metadataValue) ->
                attribute(attributes, "langfuse.observation.metadata." + key, metadataValue));

        ObjectNode status = span.putObject("status");
        if (call.failed()) {
            status.put("code", 2); // ERROR
            status.put("message", call.errorMessage());
            attribute(attributes, "langfuse.observation.level", "ERROR");
            attribute(attributes, "langfuse.observation.status_message", call.errorMessage());
        } else {
            status.put("code", 1); // OK
        }

        ObjectNode scopeSpans = mapper.createObjectNode();
        scopeSpans.putObject("scope").put("name", "acttub-api");
        scopeSpans.putArray("spans").add(span);

        ObjectNode resourceSpans = mapper.createObjectNode();
        ArrayNode resourceAttributes = resourceSpans.putObject("resource").putArray("attributes");
        attribute(resourceAttributes, "service.name", "acttub-api");
        resourceSpans.putArray("scopeSpans").add(scopeSpans);

        ObjectNode payload = mapper.createObjectNode();
        payload.putArray("resourceSpans").add(resourceSpans);
        return payload;
    }

    JsonNode scorePayload(LlmScore score) {
        ObjectNode payload = mapper.createObjectNode();
        payload.put("traceId", traceId(score.practiceSessionId()));
        payload.put("name", score.name());
        payload.put("dataType", score.dataType());
        if (score.value() instanceof Number number) {
            payload.put("value", number.doubleValue());
        } else {
            payload.put("value", String.valueOf(score.value()));
        }
        if (score.comment() != null && !score.comment().isBlank()) {
            payload.put("comment", score.comment());
        }
        return payload;
    }

    private void attribute(ArrayNode attributes, String key, String value) {
        if (value == null || value.isEmpty()) {
            return;
        }
        ObjectNode entry = attributes.addObject();
        entry.put("key", key);
        entry.putObject("value").put("stringValue", value);
    }

    private String usage(LlmTokens tokens) {
        ObjectNode node = mapper.createObjectNode();
        if (tokens.input() != null) {
            node.put("input", tokens.input());
        }
        if (tokens.output() != null) {
            node.put("output", tokens.output());
        }
        if (tokens.total() != null) {
            node.put("total", tokens.total());
        }
        return node.toString();
    }

    /** UUID 는 정확히 16바이트다 — 그대로 추적 ID 가 된다. */
    static String traceId(UUID id) {
        return String.format(
                "%016x%016x", id.getMostSignificantBits(), id.getLeastSignificantBits());
    }

    private static String randomSpanId() {
        return String.format("%016x", UUID.randomUUID().getMostSignificantBits());
    }

    private static String basic(String publicKey, String secretKey) {
        String raw = publicKey + ":" + secretKey;
        return "Basic " + Base64.getEncoder()
                .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    private static String value(Function<String, String> environment, String name) {
        String raw = environment.apply(name);
        return raw == null ? "" : raw.strip();
    }

    private static String trimTrailingSlash(String raw) {
        return raw.endsWith("/") ? raw.substring(0, raw.length() - 1) : raw;
    }

    private static org.springframework.http.client.ClientHttpRequestFactory timeoutFactory() {
        var factory = new org.springframework.http.client.JdkClientHttpRequestFactory(
                java.net.http.HttpClient.newBuilder().connectTimeout(TIMEOUT).build());
        factory.setReadTimeout(TIMEOUT);
        return factory;
    }

    /**
     * 보내는 일꾼. 큐가 차면 새 일을 거절해 부르는 쪽이 버리게 한다 — 기다리게 하지 않는다.
     * 일꾼을 둘로 둔 이유는 하나가 느린 응답에 물려도 나머지가 돈다는 것뿐이다.
     */
    private static Executor defaultSender() {
        ThreadPoolExecutor executor = new ThreadPoolExecutor(
                1, 2, 60, TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(QUEUE_CAPACITY),
                runnable -> {
                    Thread thread = new Thread(runnable, "llm-telemetry");
                    thread.setDaemon(true);
                    return thread;
                },
                new ThreadPoolExecutor.AbortPolicy());
        executor.allowCoreThreadTimeOut(true);
        return executor;
    }

    /** 시험이 쓰는 자리 — 설정이 실제로 꺼졌는지 본다. */
    boolean isEnabled() {
        return enabled;
    }

    /** 시험이 쓰는 자리 — 지금까지 버린 건수. */
    long droppedCount() {
        return dropped.get();
    }

    Map<String, String> configuredHost() {
        return Map.of("host", host);
    }
}
