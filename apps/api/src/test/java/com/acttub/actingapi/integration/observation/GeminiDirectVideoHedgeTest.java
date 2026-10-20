package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.Client;
import com.google.genai.types.HttpOptions;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** 느린 요청 다시 보내기와 이름표 파일(SOMA-780)을 가짜 Gemini 서버로 본다. 서버는 요청을 동시에 받는다. */
class GeminiDirectVideoHedgeTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final DirectVideoModel.Video VIDEO =
            new DirectVideoModel.Video("files/take-1", "https://example.test/take-1", "video/mp4");
    private static final List<DirectVideoModel.Message> HISTORY = List.of(new DirectVideoModel.Message("user", "배우의 답"));

    @TempDir Path directory;
    private final AtomicInteger calls = new AtomicInteger();
    private final List<String> requests = Collections.synchronizedList(new ArrayList<>());
    private final List<JsonNode> bodies = Collections.synchronizedList(new ArrayList<>());
    private final AtomicReference<Handler> handler = new AtomicReference<>();
    private HttpServer server;
    private Client client;
    private String base;

    interface Handler {
        void handle(int call, HttpExchange exchange) throws Exception;
    }

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.setExecutor(Executors.newCachedThreadPool());
        server.createContext("/", exchange -> {
            int call = calls.incrementAndGet();
            requests.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath());
            byte[] raw = exchange.getRequestBody().readAllBytes();
            try {
                bodies.add(raw.length == 0 ? null : JSON.readTree(raw));
            } catch (Exception binary) {
                bodies.add(null);
            }
            try {
                handler.get().handle(call, exchange);
            } catch (Exception ignored) {
                // 진 쪽 연결을 클라이언트가 닫으면 쓰기가 실패한다.
            } finally {
                exchange.close();
            }
        });
        server.start();
        base = "http://127.0.0.1:" + server.getAddress().getPort();
        client = Client.builder().apiKey("not-a-real-key").httpOptions(HttpOptions.builder().baseUrl(base).build()).build();
    }

    @AfterEach
    void stop() {
        client.close();
        server.stop(0);
    }

    private GeminiDirectVideoModel hedged(long classifyMillis, long replyMillis, long streamMillis) {
        return new GeminiDirectVideoModel(client, "gemini-3-flash-preview").withHedge(new GeminiDirectVideoModel.Hedge(
                Duration.ofMillis(classifyMillis), Duration.ofMillis(replyMillis), Duration.ofMillis(streamMillis)));
    }

    @Test
    void aSlowReplyIsSentOnceMoreAndTheFasterAnswerIsUsed() {
        handler.set((call, exchange) -> {
            if (call == 1) Thread.sleep(3000);
            json(exchange, chunk(call == 1 ? "느린 답" : "빠른 답", "STOP"));
        });
        long started = System.nanoTime();
        String reply = hedged(0, 300, 0).reply(VIDEO, HISTORY, "코칭 지침");
        assertThat(reply).isEqualTo("빠른 답");
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(2500));
        assertThat(calls.get()).isEqualTo(2);
        // 다시 보낸 요청은 처음 요청과 똑같다 — 코치가 받는 입력이 바뀌지 않는다.
        assertThat(bodies.get(1)).isEqualTo(bodies.get(0));
    }

    @Test
    void aReplyThatArrivesInTimeIsNotSentTwiceAndHedgingOffKeepsOneCall() {
        handler.set((call, exchange) -> json(exchange, chunk("바로 온 답", "STOP")));
        assertThat(hedged(0, 2000, 0).reply(VIDEO, HISTORY, "지침")).isEqualTo("바로 온 답");
        assertThat(new GeminiDirectVideoModel(client, "gemini-3-flash-preview").reply(VIDEO, HISTORY, "지침"))
                .isEqualTo("바로 온 답");
        assertThat(calls.get()).isEqualTo(2);
    }

    @Test
    void aSlowClassificationIsSentOnceMoreToo() {
        handler.set((call, exchange) -> {
            if (call == 1) Thread.sleep(3000);
            json(exchange, chunk(call == 1 ? "{\"signals\":[\"stop\"]}" : "{\"signals\":[\"answered\"]}", "STOP"));
        });
        String signals = hedged(300, 0, 0).classify(HISTORY, "분류 지침", List.of("answered", "stop"));
        assertThat(signals).isEqualTo("{\"signals\":[\"answered\"]}");
        assertThat(calls.get()).isEqualTo(2);
    }

    @Test
    void whenBothAttemptsFailTheOriginalRequestsErrorIsThrown() {
        handler.set((call, exchange) -> {
            if (call == 1) Thread.sleep(800);
            byte[] bytes = ("{\"error\":{\"code\":400,\"message\":\"" + (call == 1 ? "first-failure" : "second-failure")
                    + "\",\"status\":\"INVALID_ARGUMENT\"}}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(400, bytes.length);
            exchange.getResponseBody().write(bytes);
        });
        assertThatThrownBy(() -> hedged(0, 200, 0).reply(VIDEO, HISTORY, "지침"))
                .hasMessageContaining("first-failure");
        assertThat(calls.get()).isEqualTo(2);
    }

    @Test
    void aBlankAnswerFromTheResentRequestIsStillAnEmptyReply() {
        handler.set((call, exchange) -> {
            if (call == 1) Thread.sleep(800);
            json(exchange, chunk("  ", "STOP"));
        });
        assertThatThrownBy(() -> hedged(0, 200, 0).reply(VIDEO, HISTORY, "지침"))
                .hasMessage("empty video coaching reply");
    }

    @Test
    void aStreamThatSendsNothingIsOpenedAgainAndOnlyTheWinnerReachesTheActor() {
        handler.set((call, exchange) -> {
            if (call == 1) Thread.sleep(3000);
            sse(exchange, chunk(call == 1 ? "느린 " : "빠른 ", null), chunk(call == 1 ? "답" : "답이에요", "STOP"));
        });
        List<String> pieces = Collections.synchronizedList(new ArrayList<>());
        long started = System.nanoTime();
        String reply = hedged(0, 0, 300).replyStream(VIDEO, HISTORY, "지침", pieces::add);
        assertThat(reply).isEqualTo("빠른 답이에요");
        assertThat(pieces).containsExactly("빠른 ", "답이에요");
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofMillis(2500));
        assertThat(calls.get()).isEqualTo(2);
    }

    @Test
    void aStreamThatStartsInTimeIsNotOpenedTwice() {
        handler.set((call, exchange) -> sse(exchange, chunk("바로 ", null), chunk("왔어요", "STOP")));
        List<String> pieces = new ArrayList<>();
        assertThat(hedged(0, 0, 2000).replyStream(VIDEO, HISTORY, "지침", pieces::add)).isEqualTo("바로 왔어요");
        assertThat(pieces).containsExactly("바로 ", "왔어요");
        assertThat(calls.get()).isEqualTo(1);
    }

    @Test
    void aHedgedStreamCutByTheOutputLimitIsStillAnEmptyReply() {
        handler.set((call, exchange) -> sse(exchange, chunk("<생각> 끊긴", "MAX_TOKENS")));
        assertThatThrownBy(() -> hedged(0, 0, 2000).replyStream(VIDEO, HISTORY, "지침", piece -> { }))
                .hasMessage("empty video coaching reply: output limit reached");
    }

    @Test
    void labeledUploadNamesTheFileWithItsAudioFact() throws Exception {
        handler.set((call, exchange) -> {
            if (exchange.getRequestURI().getPath().equals("/bytes")) {
                exchange.getResponseHeaders().add("X-Goog-Upload-Status", "final");
                json(exchange, "{\"file\":{\"name\":\"files/take-9\",\"mimeType\":\"video/mp4\","
                        + "\"uri\":\"https://files.test/take-9\",\"state\":\"PROCESSING\"}}");
            } else {
                exchange.getResponseHeaders().add("X-Goog-Upload-URL", base + "/bytes");
                json(exchange, "{}");
            }
        });
        var model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview", path -> true, path -> false, path -> true);
        Path source = Files.write(directory.resolve("take.mp4"), new byte[]{1, 2, 3});
        var video = model.upload(source, "video/mp4", new DirectVideoModel.InputInspection(true, null, true),
                "acttub-coach:prod:practice:abc");
        assertThat(video.hasAudioTrack()).isTrue();
        assertThat(bodies.getFirst().path("file").path("displayName").asText()).isEqualTo("acttub-coach:prod:practice:abc:a1");

        bodies.clear();
        model.upload(source, "video/mp4");
        assertThat(bodies.getFirst().path("file").has("displayName")).as("이름표 없이 올리면 예전과 같다").isFalse();
    }

    @Test
    void labeledFilesAreFoundByPrefixWithTheirAudioFact() {
        handler.set((call, exchange) -> json(exchange, """
                {"files":[
                 {"name":"files/a","displayName":"acttub-coach:prod:p1:abc:a1","uri":"https://files.test/a","mimeType":"video/mp4","state":"ACTIVE","createTime":"2026-10-20T09:00:00Z"},
                 {"name":"files/b","displayName":"acttub-coach:prod:p1:def:a0","uri":"https://files.test/b","mimeType":"video/quicktime","state":"PROCESSING","createTime":"2026-10-20T09:01:00Z"},
                 {"name":"files/c","displayName":"acttub-coach:prod:p1:ghi:a1","uri":"https://files.test/c","mimeType":"video/mp4","state":"FAILED"},
                 {"name":"files/d","displayName":"challenge-report","uri":"https://files.test/d","mimeType":"video/mp4","state":"ACTIVE"},
                 {"name":"files/e","displayName":"acttub-coach:dev:p1:abc:a1","uri":"https://files.test/e","mimeType":"video/mp4","state":"ACTIVE"}
                ]}"""));
        var found = new GeminiDirectVideoModel(client, "gemini-3-flash-preview").labeled("acttub-coach:prod:p1:");
        assertThat(found).hasSize(2);
        assertThat(found.get(0).label()).isEqualTo("acttub-coach:prod:p1:abc");
        assertThat(found.get(0).video()).isEqualTo(new DirectVideoModel.Video("files/a", "https://files.test/a", "video/mp4", true));
        assertThat(found.get(0).created()).isEqualTo(java.time.Instant.parse("2026-10-20T09:00:00Z"));
        assertThat(found.get(1).video().hasAudioTrack()).isFalse();
        assertThat(found.get(1).video().mimeType()).isEqualTo("video/quicktime");
        assertThat(requests).allSatisfy(request -> assertThat(request).isEqualTo("GET /v1beta/files"));
    }

    private static void json(HttpExchange exchange, String body) throws Exception {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(200, bytes.length);
        exchange.getResponseBody().write(bytes);
    }

    private static void sse(HttpExchange exchange, String... chunks) throws Exception {
        StringBuilder body = new StringBuilder();
        for (String chunk : chunks) body.append("data: ").append(chunk).append("\r\n\r\n");
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
        exchange.sendResponseHeaders(200, bytes.length);
        exchange.getResponseBody().write(bytes);
    }

    private static String chunk(String text, String finishReason) {
        try {
            return "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":" + JSON.writeValueAsString(text) + "}],\"role\":\"model\"}"
                    + (finishReason == null ? "" : ",\"finishReason\":\"" + finishReason + "\"") + "}]}";
        } catch (Exception impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    @Test
    void streamsThatNeverWriteAnythingEndAsAnEmptyReply() {
        handler.set((call, exchange) -> {
            if (call == 1) Thread.sleep(500);
            sse(exchange, chunk("", "STOP"));
        });
        assertThatThrownBy(() -> hedged(0, 0, 200).replyStream(VIDEO, HISTORY, "지침", piece -> { }))
                .hasMessage("empty video coaching reply");
        assertThat(calls.get()).isEqualTo(2);
    }

    @Test
    void aRequestThatFailsBeforeTheDeadlineIsNotSentAgain() {
        handler.set((call, exchange) -> {
            byte[] bytes = "{\"error\":{\"code\":400,\"message\":\"bad-request\",\"status\":\"INVALID_ARGUMENT\"}}"
                    .getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(400, bytes.length);
            exchange.getResponseBody().write(bytes);
        });
        assertThatThrownBy(() -> hedged(2000, 2000, 0).classify(HISTORY, "지침", List.of("answered")))
                .hasMessageContaining("bad-request");
        assertThat(calls.get()).isEqualTo(1);
        assertThat(new GeminiDirectVideoModel(client, "gemini-3-flash-preview").withHedge(null).labeled(" ")).isEmpty();
        assertThat(calls.get()).as("빈 접두어는 목록을 부르지 않는다").isEqualTo(1);
    }

    @Test
    void labelsWithoutAnAudioMarkAndFilesWithoutAnAddressAreHandled() {
        handler.set((call, exchange) -> json(exchange, """
                {"files":[
                 {"name":"files/a","displayName":"acttub-coach:prod:p2:old","uri":"https://files.test/a","mimeType":"video/mp4","state":"ACTIVE"},
                 {"name":"files/b","displayName":"acttub-coach:prod:p2:nouri","mimeType":"video/mp4","state":"ACTIVE"}
                ]}"""));
        var found = new GeminiDirectVideoModel(client, "gemini-3-flash-preview").labeled("acttub-coach:prod:p2:");
        assertThat(found).singleElement().satisfies(file -> {
            assertThat(file.label()).isEqualTo("acttub-coach:prod:p2:old");
            assertThat(file.video().hasAudioTrack()).isNull();
            assertThat(file.created()).isNull();
        });
    }

    @Test
    void unwrapKeepsRuntimeErrorsAndWrapsCheckedOnes() {
        var runtime = new IllegalArgumentException("x");
        assertThat(GeminiDirectVideoModel.unwrap(new java.util.concurrent.CompletionException(runtime))).isSameAs(runtime);
        assertThat(GeminiDirectVideoModel.unwrap(new java.io.IOException("io"))).isInstanceOf(IllegalStateException.class)
                .hasCauseInstanceOf(java.io.IOException.class);
    }
}
