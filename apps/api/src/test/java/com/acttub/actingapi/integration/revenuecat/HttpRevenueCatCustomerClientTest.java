package com.acttub.actingapi.integration.revenuecat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
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

/** 탈퇴 때 RevenueCat 고객 삭제(SOMA-818). 가짜 HTTP(MockRestServiceServer)로 요청 모양과 응답 해석을 본다. */
class HttpRevenueCatCustomerClientTest {
    private static final String USER = "11111111-2222-4333-8444-555555555555";
    private static final String URL = "https://api.revenuecat.com/v1/subscribers/" + USER;

    @Test
    @DisplayName("스위치가 꺼졌거나 비밀 키가 없으면 꺼진 것이고, 지우라고 하면 부르지 않고 거절한다")
    void offWithoutSwitchOrKey() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();

        assertThat(new HttpRevenueCatCustomerClient(false, "sk_live", builder).enabled()).isFalse();
        HttpRevenueCatCustomerClient noKey = new HttpRevenueCatCustomerClient(true, "  ", builder);
        assertThat(noKey.enabled()).isFalse();
        assertThatThrownBy(() -> noKey.delete(USER)).isInstanceOf(RevenueCatUnavailable.class);
        server.verify();
    }

    @Test
    @DisplayName("DELETE /v1/subscribers/{app_user_id} 를 비밀 키 Bearer 로 부르고 200 이면 끝난다")
    void deletesCustomer() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo(URL))
                .andExpect(method(HttpMethod.DELETE))
                .andExpect(header("Authorization", "Bearer sk_secret"))
                .andRespond(withSuccess("{\"app_user_id\":\"" + USER + "\"}", MediaType.APPLICATION_JSON));
        HttpRevenueCatCustomerClient client = new HttpRevenueCatCustomerClient(true, " sk_secret ", builder);

        assertThat(client.enabled()).isTrue();
        assertThatCode(() -> client.delete(USER)).doesNotThrowAnyException();
        server.verify();
    }

    @Test
    @DisplayName("404(이미 없는 고객)도 성공이다 — 다시 시도해도 안전하다")
    void notFoundIsDone() {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo(URL)).andExpect(method(HttpMethod.DELETE)).andRespond(withStatus(HttpStatus.NOT_FOUND));

        assertThatCode(() -> new HttpRevenueCatCustomerClient(true, "sk_secret", builder).delete(USER))
                .doesNotThrowAnyException();
        server.verify();
    }

    @Test
    @DisplayName("키 거절(401)·서버 오류(500)·한도(429)는 실패로 올려 장부가 다시 시도하게 하고, 메시지에 키·사용자 ID 가 없다")
    void failuresAreRetried() {
        for (HttpStatus status : new HttpStatus[] {HttpStatus.UNAUTHORIZED, HttpStatus.INTERNAL_SERVER_ERROR,
                HttpStatus.TOO_MANY_REQUESTS}) {
            RestClient.Builder builder = RestClient.builder();
            MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
            server.expect(requestTo(URL)).andRespond(
                    status.is5xxServerError() ? withServerError() : withStatus(status));

            assertThatThrownBy(() -> new HttpRevenueCatCustomerClient(true, "sk_secret", builder).delete(USER))
                    .isInstanceOf(RevenueCatUnavailable.class)
                    .satisfies(e -> assertThat(e.getMessage()).doesNotContain("sk_secret").doesNotContain(USER));
            server.verify();
        }
    }
}
