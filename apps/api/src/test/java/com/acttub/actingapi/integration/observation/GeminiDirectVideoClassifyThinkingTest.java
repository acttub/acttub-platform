package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import com.acttub.actingapi.platform.json.LenientJson;

/** 분류 생각 단계(ACTTUB_COACH_CLASSIFY_THINKING): 정하면 분류 요청만 그 단계이고, 비우면 예전과 같은 요청이다. */
class GeminiDirectVideoClassifyThinkingTest {
    static JsonNode thinking(JsonNode request) {
        return request.path("generationConfig").path("thinkingConfig");
    }

    @Test void minimalAppliesToTheClassifyRequestOnly() throws Exception {
        List<JsonNode> sent = GeminiDirectVideoFpsTest.requests(model -> model.withClassifyThinking("minimal"),
                GeminiDirectVideoFpsTest::turns);
        assertThat(sent).hasSize(3);
        assertThat(LenientJson.asText(thinking(sent.get(0)).path("thinkingLevel"))).isEqualTo("LOW");
        assertThat(LenientJson.asText(thinking(sent.get(2)).path("thinkingLevel"))).isEqualTo("MINIMAL");
    }

    @Test void unsetTheRequestsAreByteForByteTheSame() throws Exception {
        List<JsonNode> before = GeminiDirectVideoFpsTest.requests(model -> model, GeminiDirectVideoFpsTest::turns);
        List<JsonNode> blank = GeminiDirectVideoFpsTest.requests(model -> model.withClassifyThinking(" "),
                GeminiDirectVideoFpsTest::turns);
        assertThat(LenientJson.asText(thinking(before.get(2)).path("thinkingLevel"))).isEqualTo("LOW");
        assertThat(blank.toString()).isEqualTo(before.toString());
    }

    @Test void theHedgeAndFpsCopiesKeepTheLevel() throws Exception {
        List<JsonNode> sent = GeminiDirectVideoFpsTest.requests(
                model -> model.withClassifyThinking("minimal").withHedge(GeminiDirectVideoModel.Hedge.NONE).withVideoFps(0.5),
                GeminiDirectVideoFpsTest::turns);
        assertThat(LenientJson.asText(thinking(sent.get(2)).path("thinkingLevel"))).isEqualTo("MINIMAL");
    }
}
