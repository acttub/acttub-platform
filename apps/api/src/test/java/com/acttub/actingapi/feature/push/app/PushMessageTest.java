package com.acttub.actingapi.feature.push.app;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import org.junit.jupiter.api.Test;
import com.acttub.actingapi.platform.json.LenientJson;

class PushMessageTest {

    @Test
    void expoPayloadUsesAppChannelAndDefaultSound() throws Exception {
        // 11/2 폰 QA — 채널·소리가 없어 Expo 대체 채널로 무음 알림이 왔다.
        ObjectMapper json = new ObjectMapper();
        JsonNode node = json.readTree(json.writeValueAsString(
                new PushMessage("ExponentPushToken[x]", "Acttub", "본문", Map.of("kind", "k"))));

        assertThat(LenientJson.asText(node.path("to"))).isEqualTo("ExponentPushToken[x]");
        assertThat(LenientJson.asText(node.path("title"))).isEqualTo("Acttub");
        assertThat(LenientJson.asText(node.path("channelId"))).isEqualTo("default");
        assertThat(LenientJson.asText(node.path("sound"))).isEqualTo("default");
        assertThat(LenientJson.asText(node.path("data").path("kind"))).isEqualTo("k");
    }
}
