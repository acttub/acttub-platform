package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.UncheckedIOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.Client;
import com.google.genai.types.HttpOptions;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** 파일 상태·스트리밍 답·영상 비교·삭제가 Gemini HTTP 요청과 응답에서 어떻게 보이는지 — 가짜 Gemini 서버로 본다. */
class GeminiDirectVideoModelHttpTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final DirectVideoModel.Video VIDEO =
            new DirectVideoModel.Video("files/take-1", "https://example.test/take-1", "video/mp4");

    private final Deque<Response> responses = new ArrayDeque<>();
    private final List<String> requests = new ArrayList<>();
    private final List<JsonNode> bodies = new ArrayList<>();
    private HttpServer server;
    private Client client;

    private record Response(int status, String contentType, String body) {
        Response(String contentType, String body) {
            this(200, contentType, body);
        }
    }

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requests.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath());
            byte[] raw = exchange.getRequestBody().readAllBytes();
            bodies.add(raw.length == 0 ? null : JSON.readTree(raw));
            Response response = responses.isEmpty() ? new Response("application/json", "{}") : responses.removeFirst();
            byte[] body = response.body().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", response.contentType());
            exchange.sendResponseHeaders(response.status(), body.length);
            exchange.getResponseBody().write(body);
            exchange.close();
        });
        server.start();
        client = Client.builder().apiKey("not-a-real-key").httpOptions(HttpOptions.builder()
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort()).build()).build();
    }

    @AfterEach
    void stop() {
        client.close();
        server.stop(0);
    }

    private void respond(String json) {
        responses.add(new Response("application/json", json));
    }

    private void stream(String... chunks) {
        StringBuilder body = new StringBuilder();
        for (String chunk : chunks) {
            body.append("data: ").append(chunk).append("\r\n\r\n");
        }
        responses.add(new Response("text/event-stream", body.toString()));
    }

    private static String chunk(String text, String finishReason) {
        return "{\"candidates\":[{\"content\":{\"parts\":[{\"text\":" + quote(text) + "}],\"role\":\"model\"}"
                + (finishReason == null ? "" : ",\"finishReason\":\"" + finishReason + "\"") + "}]}";
    }

    private static String quote(String text) {
        try {
            return JSON.writeValueAsString(text);
        } catch (Exception impossible) {
            throw new IllegalStateException(impossible);
        }
    }

    @Test
    void readyFollowsTheUploadedFileState() {
        GeminiDirectVideoModel model = new GeminiDirectVideoModel(client, "gemini-2.5-flash");
        respond("{\"name\":\"files/take-1\",\"state\":\"PROCESSING\"}");
        respond("{\"name\":\"files/take-1\",\"state\":\"ACTIVE\"}");
        respond("{\"name\":\"files/take-1\",\"state\":\"FAILED\"}");

        assertThat(model.ready(VIDEO)).isFalse();
        assertThat(model.ready(VIDEO)).isTrue();
        assertThatThrownBy(() -> model.ready(VIDEO)).hasMessage("video processing failed");
        assertThat(requests).allSatisfy(request -> assertThat(request).isEqualTo("GET /v1beta/files/take-1"));
    }

    @Test
    void streamedReplyPassesEachNonEmptyPieceAndReturnsTheStrippedWhole() {
        GeminiDirectVideoModel model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview");
        stream(chunk(" 처음 ", null), chunk("", null), chunk("끝까지 봐요", "STOP"));
        List<String> pieces = new ArrayList<>();

        String reply = model.replyStream(VIDEO, List.of(new DirectVideoModel.Message("user", "배우의 답")),
                "코칭 지침", pieces::add);

        assertThat(reply).isEqualTo("처음 끝까지 봐요");
        assertThat(pieces).containsExactly(" 처음 ", "끝까지 봐요");
        assertThat(requests).singleElement().asString().contains(":streamGenerateContent");
        assertThat(bodies.getFirst().path("contents").get(0).path("parts").get(0).path("fileData").path("fileUri")
                .asText()).isEqualTo("https://example.test/take-1");
    }

    @Test
    void streamedReplyCutByTheOutputLimitOrLeftBlankIsAnEmptyReply() {
        GeminiDirectVideoModel model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview");
        stream(chunk("<생각> 끊긴", "MAX_TOKENS"));
        stream(chunk("   ", "STOP"));
        List<DirectVideoModel.Message> history = List.of(new DirectVideoModel.Message("user", "배우의 답"));

        assertThatThrownBy(() -> model.replyStream(VIDEO, history, "지침", piece -> { }))
                .hasMessage("empty video coaching reply: output limit reached");
        assertThatThrownBy(() -> model.replyStream(VIDEO, history, "지침", piece -> { }))
                .hasMessage("empty video coaching reply");
    }

    @Test
    void olderModelsTurnThinkingOffAndABlankReplyIsEmpty() {
        GeminiDirectVideoModel model = new GeminiDirectVideoModel(client, "gemini-2.5-flash");
        respond(chunk("  ", "STOP"));

        assertThatThrownBy(() -> model.reply(VIDEO, List.of(new DirectVideoModel.Message("user", "답")), "지침"))
                .hasMessage("empty video coaching reply");
        assertThat(bodies.getFirst().path("generationConfig").path("thinkingConfig").path("thinkingBudget").asInt())
                .isZero();
        assertThat(model.model()).isEqualTo("gemini-2.5-flash");
    }

    @Test
    void compareSendsEachLabelBeforeItsVideoAndAsksForJson() {
        GeminiDirectVideoModel model = new GeminiDirectVideoModel(client, "gemini-2.5-flash");
        respond(chunk(" {\"same\":true} ", "STOP"));
        DirectVideoModel.Video second = new DirectVideoModel.Video("files/take-2", "https://example.test/take-2", "video/quicktime");

        String result = model.compare(List.of(VIDEO, second), List.of("1차", "2차"), "비교 지침");

        assertThat(result).isEqualTo("{\"same\":true}");
        JsonNode parts = bodies.getFirst().path("contents").get(0).path("parts");
        assertThat(parts).hasSize(4);
        assertThat(parts.get(0).path("text").asText()).isEqualTo("1차");
        assertThat(parts.get(1).path("fileData").path("fileUri").asText()).isEqualTo("https://example.test/take-1");
        assertThat(parts.get(2).path("text").asText()).isEqualTo("2차");
        assertThat(parts.get(3).path("fileData").path("mimeType").asText()).isEqualTo("video/quicktime");
        JsonNode config = bodies.getFirst().path("generationConfig");
        assertThat(config.path("responseMimeType").asText()).isEqualTo("application/json");
        assertThat(config.path("maxOutputTokens").asInt()).isEqualTo(8192);
        assertThat(config.path("thinkingConfig").path("thinkingBudget").asInt()).isZero();
    }

    @Test
    void compareNeedsALabelPerVideoAndANonBlankAnswer() {
        GeminiDirectVideoModel model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview");
        respond(chunk(" ", "STOP"));

        assertThatThrownBy(() -> model.compare(List.of(VIDEO), List.of(), "지침"))
                .isInstanceOf(IllegalArgumentException.class).hasMessage("each video needs a label");
        assertThat(requests).isEmpty();
        assertThatThrownBy(() -> model.compare(List.of(VIDEO), List.of("1차"), "지침"))
                .hasMessage("empty video comparison");
        assertThat(bodies.getFirst().path("generationConfig").path("thinkingConfig").path("thinkingLevel").asText())
                .isEqualTo("LOW");
    }

    @Test
    void lightCallsThinkMinimallyOnlyWhereTheModelAllowsIt() {
        // SOMA-780: 3.0 Flash 는 줄이기를 MINIMAL 로, 분류·코치 답은 LOW 로 부른다.
        GeminiDirectVideoModel flash = new GeminiDirectVideoModel(client, "gemini-3-flash-preview");
        respond(chunk("짧게 다듬은 말", "STOP"));
        assertThat(flash.replyLight(null, List.of(new DirectVideoModel.Message("user", "긴 코치 말")), "줄이기"))
                .isEqualTo("짧게 다듬은 말");
        respond(chunk("{\"signals\":[\"answer\"]}", "STOP"));
        flash.classify(List.of(new DirectVideoModel.Message("user", "배우의 답")), "분류", List.of("answer"));
        respond(chunk("코치 답", "STOP"));
        flash.reply(VIDEO, List.of(new DirectVideoModel.Message("user", "배우의 답")), "지침");
        // 3.8 Flash 는 MINIMAL 을 받지 않는다 — 가벼운 호출도 LOW 다.
        respond(chunk("짧게", "STOP"));
        new GeminiDirectVideoModel(client, "gemini-3.8-flash")
                .replyLight(null, List.of(new DirectVideoModel.Message("user", "긴 코치 말")), "줄이기");

        assertThat(bodies).extracting(body -> body.path("generationConfig").path("thinkingConfig").path("thinkingLevel").asText())
                .containsExactly("MINIMAL", "LOW", "LOW", "LOW");
        assertThat(GeminiDirectVideoModel.minimalThinking(null)).isFalse();
    }

    @Test
    void followUpRepliesThinkMinimallyButTheFirstQuestionAndSwitchedOffTurnsStayLow() {
        // SOMA-780: 답장은 MINIMAL(일반·스트리밍 모두), 첫 질문과 끄기 스위치(false)는 LOW, MINIMAL 을 못 받는 모델은 LOW 다.
        GeminiDirectVideoModel flash = new GeminiDirectVideoModel(client, "gemini-3-flash-preview");
        var history = List.of(new DirectVideoModel.Message("user", "배우의 답"));
        ReplyTrace followUp = new ReplyTrace(true);
        respond(chunk("답장", "STOP").replace("}]}", "}],\"usageMetadata\":{\"candidatesTokenCount\":12,\"thoughtsTokenCount\":7}}"));
        followUp.run(() -> flash.reply(VIDEO, history, "지침"));
        stream(chunk("스트리밍 답장", "STOP"));
        followUp.run(() -> flash.replyStream(VIDEO, history, "지침", piece -> { }));
        ReplyTrace first = new ReplyTrace(false);
        respond(chunk("첫 질문", "STOP"));
        first.run(() -> flash.reply(VIDEO, List.of(), "지침"));
        respond(chunk("{\"signals\":[\"answer\"]}", "STOP"));
        followUp.run(() -> flash.classify(history, "분류", List.of("answer")));
        respond(chunk("3.8 답장", "STOP"));
        ReplyTrace other = new ReplyTrace(true);
        other.run(() -> new GeminiDirectVideoModel(client, "gemini-3.8-flash").reply(VIDEO, history, "지침"));

        assertThat(bodies).extracting(body -> body.path("generationConfig").path("thinkingConfig").path("thinkingLevel").asText())
                .containsExactly("MINIMAL", "MINIMAL", "LOW", "LOW", "LOW");
        assertThat(followUp.thinking()).isEqualTo("minimal");
        assertThat(followUp.thoughtsTokens()).isEqualTo(7);
        assertThat(followUp.candidatesTokens()).isEqualTo(12);
        assertThat(first.thinking()).isEqualTo("low");
        assertThat(other.thinking()).isEqualTo("low");
    }

    @Test
    void aModelWithoutALightModeAnswersLightCallsTheUsualWay() {
        DirectVideoModel plain = org.mockito.Mockito.mock(DirectVideoModel.class, org.mockito.Mockito.CALLS_REAL_METHODS);
        org.mockito.Mockito.doReturn("보통 답").when(plain).reply(null, List.of(), "지침");
        assertThat(plain.replyLight(null, List.of(), "지침")).isEqualTo("보통 답");
    }

    @Test
    void deleteRemovesTheUploadedFile() {
        new GeminiDirectVideoModel(client, "gemini-3-flash-preview").delete(VIDEO);

        assertThat(requests).containsExactly("DELETE /v1beta/files/take-1");
    }

    @Test
    void deletingAFileThatIsAlreadyGoneSucceedsButOtherFailuresStillThrow() {
        GeminiDirectVideoModel model = new GeminiDirectVideoModel(client, "gemini-3-flash-preview");
        responses.add(new Response(403, "application/json", "{\"error\":{\"code\":403,\"message\":\"You do not have "
                + "permission to access the File take-1 or it may not exist.\",\"status\":\"PERMISSION_DENIED\"}}"));
        responses.add(new Response(404, "application/json",
                "{\"error\":{\"code\":404,\"message\":\"File not found.\",\"status\":\"NOT_FOUND\"}}"));
        responses.add(new Response(400, "application/json",
                "{\"error\":{\"code\":400,\"message\":\"Bad request.\",\"status\":\"INVALID_ARGUMENT\"}}"));

        model.delete(VIDEO);
        model.delete(VIDEO);
        assertThatThrownBy(() -> model.delete(VIDEO)).isInstanceOf(com.google.genai.errors.ClientException.class);
        assertThat(requests).hasSize(3);
    }

    @Test
    void uploadChecksTheAudioSignalWhenTheInspectionDidNotAndUnreadableFilesFail() {
        Path missing = Path.of("build", "no-such-take.mp4");
        GeminiDirectVideoModel silent = new GeminiDirectVideoModel(client, "gemini-3-flash-preview",
                path -> true, path -> false, path -> false);
        GeminiDirectVideoModel videoOnly = new GeminiDirectVideoModel(client, "gemini-3-flash-preview",
                path -> false, path -> false, path -> true);

        assertThatThrownBy(() -> silent.upload(missing, "video/mp4", new DirectVideoModel.InputInspection(true, null)))
                .isInstanceOf(IllegalArgumentException.class).hasMessage("silent audio must not be uploaded");
        assertThatThrownBy(() -> silent.upload(missing, "video/mp4", null))
                .isInstanceOf(IllegalArgumentException.class).hasMessage("silent audio must not be uploaded");
        assertThatThrownBy(() -> videoOnly.upload(missing, "video/mp4",
                new DirectVideoModel.InputInspection(false, false)))
                .isInstanceOf(UncheckedIOException.class);
        assertThat(requests).isEmpty();
    }
}
