package com.acttub.actingapi.feature.reading.adapter.decision;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.feature.reading.app.DeciderTally;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** 판단 모델 하나를 여러 작업이 함께 써도 재시도·사용량은 부른 작업의 집계에만 든다(SOMA-1019). */
class OpenRouterLineDeciderTallyTest {
    /** 2026-11-03 dev 키로 합성 문장을 1회 보내 받은 응답의 모양. */
    private static final String ANSWER = """
            {"model":"typesafe/jev-1.14-20261014","answers":{"script":{"type":"choice","choice":"speech","probabilities":{"speech":1,"other":0},"confidence":1}},\
            "usage":{"input_tokens":373,"output_tokens":31,"cost":0.000015666},"id":"gen-dec-1","provider":"TypeSafe"}""";

    private final Map<String, AtomicInteger> seen = new ConcurrentHashMap<>();
    private HttpServer server;
    private OpenRouterLineDecider decider;

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", this::answer);
        server.setExecutor(java.util.concurrent.Executors.newCachedThreadPool());
        server.start();
        decider = new OpenRouterLineDecider(URI.create("http://127.0.0.1:" + server.getAddress().getPort() + "/"), new ObjectMapper(),
                "jev", "key", Duration.ofSeconds(5), 8);
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    /** 첫 요청만 글에 적힌 상태로 답하고, 그다음은 성공한다. */
    private void answer(HttpExchange exchange) throws IOException {
        String body = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
        String job = body.contains("throttled") ? "throttled" : body.contains("broken") ? "broken" : body.contains("bare") ? "bare" : "clean";
        int attempt = seen.computeIfAbsent(job, ignored -> new AtomicInteger()).getAndIncrement();
        int status = attempt == 0 && job.equals("throttled") ? 429 : attempt == 0 && job.equals("broken") ? 503 : 200;
        byte[] out = (job.equals("bare") ? ANSWER.replaceAll(",\"usage\":\\{[^}]*}", "") : ANSWER).getBytes(StandardCharsets.UTF_8);
        exchange.sendResponseHeaders(status, out.length);
        exchange.getResponseBody().write(out);
        exchange.close();
    }

    @Test
    void retriesAndUsageLandOnlyOnTheTallyOfTheJobThatMadeTheCall() {
        DeciderTally throttled = new DeciderTally();
        DeciderTally broken = new DeciderTally();
        DeciderTally clean = new DeciderTally();

        CompletableFuture.allOf(
                CompletableFuture.runAsync(() -> decider.speech("throttled", throttled)),
                CompletableFuture.runAsync(() -> decider.speech("broken", broken)),
                CompletableFuture.runAsync(() -> decider.speech("clean", clean))).join();

        assertThat(throttled.rateLimitRetries()).isEqualTo(1);
        assertThat(throttled.otherRetries()).isZero();
        assertThat(broken.rateLimitRetries()).isZero();
        assertThat(broken.otherRetries()).isEqualTo(1);
        assertThat(clean.rateLimitRetries()).isZero();
        assertThat(clean.otherRetries()).isZero();
        assertThat(throttled.tokens().input()).as("실패한 시도는 사용량이 없다 — 성공 응답 한 번분만").isEqualTo(373);
        assertThat(clean.tokens().output()).isEqualTo(31);
        assertThat(clean.tokens().total()).isEqualTo(404);
        assertThat(clean.cost()).isEqualTo(0.000015666);
    }

    @Test
    void anAnswerWithoutUsageLeavesTokensAndCostUnknown() {
        DeciderTally tally = new DeciderTally();
        decider.speech("bare", tally);
        assertThat(tally.tokens().isUnknown()).isTrue();
        assertThat(tally.cost()).isNull();
    }
}
