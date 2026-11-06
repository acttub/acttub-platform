package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Function;

import com.acttub.actingapi.platform.observability.LlmTokens;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.genai.Client;
import com.google.genai.types.HttpOptions;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;

/** 고정 앞부분(SOMA-1063): 실제 Gemini HTTP 요청에서 앞부분이 턴마다 같고, 이번 답 지시가 맨 끝에 붙는다. 캐시 토큰도 남는다. */
class GeminiDirectVideoStablePrefixTest {
    static final String MODEL = "gemini-3-flash-preview";
    static final ObjectMapper MAPPER = new ObjectMapper();
    static final DirectVideoModel.Video VIDEO = new DirectVideoModel.Video("files/test", "https://example.test/video", "video/mp4");
    static final String FIXED = "공통 지시\n## 배우가 쓴 것\n- 상황: 엄마와 다툰다";
    static final String RESPONSE = """
            {"candidates":[{"content":{"parts":[{"text":"다음 답변"}],"role":"model"},"finishReason":"STOP"}],
             "usageMetadata":{"promptTokenCount":9000,"cachedContentTokenCount":7000,"candidatesTokenCount":10,
             "thoughtsTokenCount":5,"totalTokenCount":9015}}
            """;

    static DirectVideoModel.Message actor(String text) { return new DirectVideoModel.Message("user", text); }
    static DirectVideoModel.Message coach(String text) { return new DirectVideoModel.Message("model", text); }

    /** 요청마다 본문을 모으는 가짜 Gemini 로 {@code calls} 를 돌린다. */
    static List<JsonNode> requests(Function<GeminiDirectVideoModel, Object> calls) throws Exception {
        var requests = new CopyOnWriteArrayList<JsonNode>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requests.add(MAPPER.readTree(exchange.getRequestBody()));
            byte[] response = RESPONSE.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        try (var client = Client.builder().apiKey("not-a-real-key").httpOptions(HttpOptions.builder()
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort()).build()).build()) {
            calls.apply(new GeminiDirectVideoModel(client, MODEL));
        } finally {
            server.stop(0);
        }
        return requests;
    }

    static String system(JsonNode request) {
        return request.path("systemInstruction").path("parts").get(0).path("text").asText();
    }

    @Test void theFrontOfTheRequestStaysTheSameAcrossTurnsAndTheTurnInstructionComesLast() throws Exception {
        String first = FIXED + DirectVideoModel.TURN_BOUNDARY + "첫 답 지시: 질문 하나";
        String second = FIXED + DirectVideoModel.TURN_BOUNDARY + "단계: 2/5\n이번 할 일: 의도 묻기";
        String third = FIXED + DirectVideoModel.TURN_BOUNDARY + "단계: 3/5\n피할 것: 비유";
        List<JsonNode> sent = requests(model -> {
            model.reply(VIDEO, List.of(), first);
            model.reply(VIDEO, List.of(coach("첫 질문"), actor("붙잡고 싶었어")), second);
            // 가벼운 다시 쓰기도 같은 요청 모양이다.
            return model.replyLight(VIDEO, List.of(coach("첫 질문"), actor("붙잡고 싶었어"), coach("그때 뭘 했어요?"),
                    actor("엄마를 봤어")), third);
        });
        assertThat(sent).hasSize(3);
        // systemInstruction 은 세 요청이 바이트까지 같고 경계 표시는 나가지 않는다.
        assertThat(system(sent.get(0))).isEqualTo(FIXED);
        assertThat(sent.get(1).path("systemInstruction").toString()).isEqualTo(sent.get(0).path("systemInstruction").toString());
        assertThat(sent.get(2).path("systemInstruction").toString()).isEqualTo(sent.get(0).path("systemInstruction").toString());
        sent.forEach(request -> assertThat(request.toString()).doesNotContain("acttub-turn", "\\u0000"));

        // 첫 답: 대화가 없어 영상 user 턴 뒤 Part 로 지시가 붙는다.
        JsonNode opening = sent.get(0).path("contents");
        assertThat(opening).hasSize(1);
        assertThat(opening.get(0).path("parts").get(0).path("fileData").path("fileUri").asText()).isEqualTo(VIDEO.uri());
        assertThat(opening.get(0).path("parts").get(1).path("text").asText())
                .isEqualTo(DirectVideoModel.TURN_HEADER + "\n첫 답 지시: 질문 하나");

        // 둘째 답: 영상 Part 는 첫 답과 같고, 지시는 배우 말 뒤 같은 user 턴의 마지막 Part 다(역할 교대 유지).
        JsonNode reply = sent.get(1).path("contents");
        assertThat(reply).hasSize(3);
        assertThat(reply.get(0).path("parts").get(0).toString()).isEqualTo(opening.get(0).path("parts").get(0).toString());
        assertThat(reply.get(0).path("parts")).hasSize(1);
        assertThat(reply.get(1).path("role").asText()).isEqualTo("model");
        assertThat(reply.get(2).path("role").asText()).isEqualTo("user");
        assertThat(reply.get(2).path("parts")).hasSize(2);
        assertThat(reply.get(2).path("parts").get(0).path("text").asText()).isEqualTo("붙잡고 싶었어");
        assertThat(reply.get(2).path("parts").get(1).path("text").asText())
                .isEqualTo(DirectVideoModel.TURN_HEADER + "\n단계: 2/5\n이번 할 일: 의도 묻기");

        // 셋째 답: 영상·이전 대화가 둘째 답과 바이트까지 같다. 이전 배우 말에는 지난 지시가 남지 않는다.
        JsonNode next = sent.get(2).path("contents");
        assertThat(next).hasSize(5);
        assertThat(next.get(0).toString()).isEqualTo(reply.get(0).toString());
        assertThat(next.get(1).toString()).isEqualTo(reply.get(1).toString());
        assertThat(next.get(2).path("parts")).hasSize(1);
        assertThat(next.get(2).path("parts").get(0).toString()).isEqualTo(reply.get(2).path("parts").get(0).toString());
        assertThat(next.get(4).path("parts").get(1).path("text").asText()).isEqualTo(DirectVideoModel.TURN_HEADER + "\n단계: 3/5\n피할 것: 비유");
        for (int i = 1; i < next.size(); i++) {
            assertThat(next.get(i).path("role").asText()).isNotEqualTo(next.get(i - 1).path("role").asText());
        }
    }

    @Test void aReplyWithoutTheVideoKeepsTheSameOrderWithoutTheVideoPart() throws Exception {
        List<JsonNode> sent = requests(model -> model.reply(null, List.of(coach("첫 질문"), actor("아니야")),
                FIXED + DirectVideoModel.TURN_BOUNDARY + "이번 할 일: 내려놓기"));
        JsonNode contents = sent.getFirst().path("contents");
        assertThat(system(sent.getFirst())).isEqualTo(FIXED);
        assertThat(contents.toString()).doesNotContain("fileData");
        assertThat(contents).hasSize(2);
        assertThat(contents.get(1).path("parts").get(1).path("text").asText()).isEqualTo(DirectVideoModel.TURN_HEADER + "\n이번 할 일: 내려놓기");
    }

    @Test void whenTheLastMessageIsTheCoachTheTurnInstructionIsItsOwnUserMessage() throws Exception {
        List<JsonNode> sent = requests(model -> model.reply(VIDEO, List.of(actor("시작"), coach("첫 질문")),
                FIXED + DirectVideoModel.TURN_BOUNDARY + "정리"));
        JsonNode contents = sent.getFirst().path("contents");
        assertThat(contents).hasSize(4);
        assertThat(contents.get(3).path("role").asText()).isEqualTo("user");
        assertThat(contents.get(3).path("parts")).hasSize(1);
        assertThat(contents.get(3).path("parts").get(0).path("text").asText()).isEqualTo(DirectVideoModel.TURN_HEADER + "\n정리");
    }

    @Test void anEmptyFixedPartSendsNoSystemInstruction() throws Exception {
        List<JsonNode> sent = requests(model -> model.reply(VIDEO, List.of(), DirectVideoModel.TURN_BOUNDARY + "지시"));
        assertThat(sent.getFirst().has("systemInstruction")).isFalse();
        assertThat(sent.getFirst().path("contents").get(0).path("parts").get(1).path("text").asText())
                .isEqualTo(DirectVideoModel.TURN_HEADER + "\n지시");
    }

    @Test void withoutTheBoundaryTheRequestIsTheSameAsBefore() throws Exception {
        String plain = FIXED + "\n\n단계: 2/5\n이번 할 일: 의도 묻기";
        List<JsonNode> sent = requests(model -> model.reply(VIDEO, List.of(coach("첫 질문"), actor("붙잡고 싶었어")), plain));
        JsonNode contents = sent.getFirst().path("contents");
        assertThat(system(sent.getFirst())).isEqualTo(plain);
        assertThat(contents).hasSize(3);
        assertThat(contents.get(2).path("parts")).hasSize(1);
        assertThat(contents.toString()).doesNotContain(DirectVideoModel.TURN_HEADER);
    }

    @Test void theClassifierIgnoresTheBoundaryAndCachedTokensAreRecordedForEveryCall() throws Exception {
        var trace = new ReplyTrace(false);
        List<JsonNode> sent = requests(model -> trace.run(() -> {
            model.reply(VIDEO, List.of(), FIXED + DirectVideoModel.TURN_BOUNDARY + "지시");
            return model.classify(List.of(coach("첫 질문"), actor("응")), "분류 지침", List.of("answered"));
        }));
        assertThat(system(sent.get(1))).isEqualTo("분류 지침");
        // 입력 합계는 캐시 적중분을 포함한 그대로이고, 적중분은 따로 남는다. 출력은 응답 + 생각 토큰이다.
        assertThat(trace.tokens(MODEL)).isEqualTo(LlmTokens.of(18000, 30, 18030, 14000));
    }

    @Test void geminiUsageKeepsTheCachedTokens() throws Exception {
        var response = com.google.genai.types.GenerateContentResponse.fromJson(RESPONSE);
        assertThat(GeminiUsage.tokens(response)).isEqualTo(LlmTokens.of(9000, 15, 9015, 7000));
        var uncached = com.google.genai.types.GenerateContentResponse.fromJson(
                "{\"usageMetadata\":{\"promptTokenCount\":12,\"candidatesTokenCount\":3,\"totalTokenCount\":15}}");
        assertThat(GeminiUsage.tokens(uncached)).isEqualTo(LlmTokens.of(12, 3, 15));
    }
}
