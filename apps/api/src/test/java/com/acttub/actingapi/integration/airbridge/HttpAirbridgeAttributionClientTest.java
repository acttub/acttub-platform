package com.acttub.actingapi.integration.airbridge;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withNoContent;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class HttpAirbridgeAttributionClientTest {
    private static final String DEVICE = "11111111-2222-3333-4444-555555555555";
    private static final String URL =
            "https://api.airbridge.io/attribution-result/v1/apps/acttub/mobile-app?device_uuid=" + DEVICE;

    @Test
    @DisplayName("토큰이 비어 있으면 꺼진 것이고 조회하면 거절한다")
    void blankTokenMeansOff() {
        HttpAirbridgeAttributionClient client = new HttpAirbridgeAttributionClient("  ", "acttub", RestClient.builder());

        assertThat(client.enabled()).isFalse();
        assertThatThrownBy(() -> client.lookup(DEVICE)).isInstanceOf(AirbridgeUnavailable.class);
    }

    @Test
    @DisplayName("200 이면 귀속 이름들을 읽고 빈 값은 null 로 둔다")
    void readsAttribution() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo(URL))
                .andExpect(method(HttpMethod.GET))
                .andExpect(header("Authorization", "Bearer secret-token"))
                .andRespond(withSuccess("""
                        {"at":"2026-10-15T00:00:00Z","data":{"attributedChannel":"facebook.business",
                         "attributedCampaign":"ACTTUB","attributedAdGroup":" ","attributedAdCreative":null,
                         "attributedContent":"c1"}}
                        """, MediaType.APPLICATION_JSON));
        HttpAirbridgeAttributionClient client = new HttpAirbridgeAttributionClient("secret-token", "acttub", builder);

        AirbridgeAttribution found = client.lookup(DEVICE).orElseThrow();

        assertThat(found).isEqualTo(new AirbridgeAttribution(
                "facebook.business", "ACTTUB", null, null, "c1", null, null));
        server.verify();
    }

    @Test
    @DisplayName("204 와 채널 없는 200 은 아직 결과가 없다는 뜻이다")
    void noResultIsEmpty() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo(URL)).andRespond(withNoContent());
        server.expect(requestTo(URL)).andRespond(withSuccess("{\"data\":{\"attributedChannel\":\"\"}}",
                MediaType.APPLICATION_JSON));
        HttpAirbridgeAttributionClient client = new HttpAirbridgeAttributionClient("t", "acttub", builder);

        assertThat(client.lookup(DEVICE)).isEmpty();
        assertThat(client.lookup(DEVICE)).isEmpty();
    }

    @Test
    @DisplayName("거절·서버 오류는 AirbridgeUnavailable 이고 메시지에 토큰·기기 ID 가 없다")
    void failuresDoNotLeakSecrets() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo(URL)).andRespond(withStatus(HttpStatus.UNAUTHORIZED));
        server.expect(requestTo(URL)).andRespond(withServerError());
        server.expect(requestTo(URL)).andRespond(withSuccess("not json", MediaType.TEXT_PLAIN));
        HttpAirbridgeAttributionClient client = new HttpAirbridgeAttributionClient("secret-token", "acttub", builder);

        for (int i = 0; i < 3; i++) {
            assertThatThrownBy(() -> client.lookup(DEVICE))
                    .isInstanceOf(AirbridgeUnavailable.class)
                    .hasMessageNotContaining("secret-token")
                    .hasMessageNotContaining(DEVICE);
        }
    }
}
