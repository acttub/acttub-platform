package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.function.Function;
import java.util.function.UnaryOperator;

import com.fasterxml.jackson.databind.JsonNode;
import com.google.genai.Client;
import com.google.genai.types.HttpOptions;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import com.acttub.actingapi.platform.json.LenientJson;

/** 코치 답 영상의 프레임 간격(ACTTUB_COACH_VIDEO_FPS): 정하면 영상 Part 에 fps 가 붙고, 정하지 않으면 예전과 같은 요청이다. */
class GeminiDirectVideoFpsTest {
    static final DirectVideoModel.Video VIDEO = GeminiDirectVideoStablePrefixTest.VIDEO;
    static final String INSTRUCTION = GeminiDirectVideoStablePrefixTest.FIXED + DirectVideoModel.TURN_BOUNDARY + "지시";

    static List<JsonNode> requests(UnaryOperator<GeminiDirectVideoModel> configure,
            Function<GeminiDirectVideoModel, Object> calls) throws Exception {
        var requests = new CopyOnWriteArrayList<JsonNode>();
        var server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", exchange -> {
            requests.add(GeminiDirectVideoStablePrefixTest.MAPPER.readTree(exchange.getRequestBody()));
            byte[] response = GeminiDirectVideoStablePrefixTest.RESPONSE.getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response);
            exchange.close();
        });
        server.start();
        try (var client = Client.builder().apiKey("not-a-real-key").httpOptions(HttpOptions.builder()
                .baseUrl("http://127.0.0.1:" + server.getAddress().getPort()).build()).build()) {
            calls.apply(configure.apply(new GeminiDirectVideoModel(client, GeminiDirectVideoStablePrefixTest.MODEL)));
        } finally {
            server.stop(0);
        }
        return requests;
    }

    static Object turns(GeminiDirectVideoModel model) {
        model.reply(VIDEO, List.of(), INSTRUCTION);
        model.replyLight(VIDEO, List.of(), INSTRUCTION);
        return model.classify(List.of(GeminiDirectVideoStablePrefixTest.coach("첫 질문"),
                GeminiDirectVideoStablePrefixTest.actor("응")), "분류 지침", List.of("answered"));
    }

    @Test void aConfiguredFpsIsSentOnTheVideoPartOnly() throws Exception {
        List<JsonNode> sent = requests(model -> model.withVideoFps(0.5), GeminiDirectVideoFpsTest::turns);
        assertThat(sent).hasSize(3);
        for (JsonNode reply : sent.subList(0, 2)) {
            JsonNode video = reply.path("contents").get(0).path("parts").get(0);
            assertThat(LenientJson.asText(video.path("fileData").path("fileUri"))).isEqualTo(VIDEO.uri());
            assertThat(LenientJson.asText(video.path("fileData").path("mimeType"))).isEqualTo(VIDEO.mimeType());
            assertThat(LenientJson.asDouble(video.path("videoMetadata").path("fps"))).isEqualTo(0.5);
        }
        // 분류에는 영상이 없다.
        assertThat(sent.get(2).toString()).doesNotContain("fileData", "videoMetadata");
    }

    @Test void withoutFpsTheRequestsAreByteForByteTheSame() throws Exception {
        List<JsonNode> before = requests(model -> model, GeminiDirectVideoFpsTest::turns);
        List<JsonNode> unset = requests(model -> model.withVideoFps(null), GeminiDirectVideoFpsTest::turns);
        List<JsonNode> zero = requests(model -> model.withVideoFps(0.0), GeminiDirectVideoFpsTest::turns);
        assertThat(before.toString()).doesNotContain("videoMetadata");
        assertThat(unset.toString()).isEqualTo(before.toString());
        assertThat(zero.toString()).isEqualTo(before.toString());
    }

    @Test void theHedgeCopyKeepsTheFps() throws Exception {
        List<JsonNode> sent = requests(model -> model.withVideoFps(2.0).withHedge(GeminiDirectVideoModel.Hedge.NONE),
                model -> model.reply(VIDEO, List.of(), INSTRUCTION));
        assertThat(LenientJson.asDouble(sent.getFirst().path("contents").get(0).path("parts").get(0).path("videoMetadata").path("fps")))
                .isEqualTo(2.0);
    }
}
