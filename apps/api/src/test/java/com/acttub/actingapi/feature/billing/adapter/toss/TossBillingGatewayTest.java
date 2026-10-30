package com.acttub.actingapi.feature.billing.adapter.toss;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Base64;

import com.acttub.actingapi.feature.billing.app.PgReviewGateway;
import com.acttub.actingapi.feature.billing.app.PgReviewGateway.GatewayException;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** 토스 호출의 모양. 실제 네트워크는 쓰지 않고 가짜 서버(MockRestServiceServer)만 쓴다. */
class TossBillingGatewayTest {
    private static final String SECRET = "test_sk_abcdefgh12345678";
    private static final String BASIC = "Basic " + Base64.getEncoder().encodeToString((SECRET + ":").getBytes(StandardCharsets.UTF_8));

    private final RestClient.Builder issueBuilder = RestClient.builder().baseUrl(TossBillingGateway.BASE_URL);
    private final RestClient.Builder approveBuilder = RestClient.builder().baseUrl(TossBillingGateway.BASE_URL);
    private final MockRestServiceServer issueServer = MockRestServiceServer.bindTo(issueBuilder).build();
    private final MockRestServiceServer approveServer = MockRestServiceServer.bindTo(approveBuilder).build();

    private TossBillingGateway gateway(String secret) {
        return new TossBillingGateway(() -> secret, issueBuilder.build(), approveBuilder.build());
    }

    @Test
    void issuesBillingKeyWithBasicAuthAndOnlyAuthKeyAndCustomerKey() {
        issueServer.expect(requestTo("https://api.tosspayments.com/v1/billing/authorizations/issue"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", BASIC))
                .andExpect(content().json("{\"authKey\":\"AK\",\"customerKey\":\"pgr_c\"}", true))
                .andRespond(withSuccess("{\"billingKey\":\"BK-1\",\"customerKey\":\"pgr_c\"}", MediaType.APPLICATION_JSON));
        assertThat(gateway(SECRET).issueBillingKey("AK", "pgr_c")).isEqualTo("BK-1");
        issueServer.verify();
    }

    @Test
    void approvesWithFixedBodyIdempotencyKeyAndNeverUsesTheGeneralConfirmApi() {
        approveServer.expect(requestTo("https://api.tosspayments.com/v1/billing/BK-1"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", BASIC))
                .andExpect(header("Idempotency-Key", "idem-1"))
                .andExpect(content().json(
                        "{\"customerKey\":\"pgr_c\",\"amount\":3900,\"orderId\":\"pgr-o\",\"orderName\":\"ACTTUB Pro 월 구독 테스트\"}", true))
                .andRespond(withSuccess(
                        "{\"status\":\"DONE\",\"orderId\":\"pgr-o\",\"totalAmount\":3900,\"approvedAt\":\"2026-10-20T09:00:00+09:00\"}",
                        MediaType.APPLICATION_JSON));
        PgReviewGateway.Approval approval = gateway(SECRET)
                .approve("BK-1", "pgr_c", "pgr-o", 3900, "ACTTUB Pro 월 구독 테스트", "idem-1");
        assertThat(approval).isEqualTo(new PgReviewGateway.Approval("DONE", "pgr-o", 3900, "2026-10-20T09:00:00+09:00"));
        approveServer.verify();
    }

    @Test
    void liveOrMalformedSecretNeverSendsAnyRequest() {
        for (String key : new String[] {"live_sk_abcdefgh12345678", "", null, "test_ck_abcdefgh12345678"}) {
            TossBillingGateway gateway = gateway(key);
            assertThatThrownBy(() -> gateway.issueBillingKey("AK", "c")).isInstanceOf(GatewayException.class)
                    .extracting(e -> ((GatewayException) e).code()).isEqualTo("secret_key_not_test");
            assertThatThrownBy(() -> gateway.approve("BK", "c", "o", 3900, "n", "i")).isInstanceOf(GatewayException.class);
        }
        // 기대한 요청이 하나도 없는 서버에 아무 요청도 가지 않았다(가면 AssertionError).
        issueServer.verify();
        approveServer.verify();
    }

    @Test
    void webBillingGatewaySendsWithALiveKeyButStillRefusesMalformedOnes() {
        String live = "live_sk_abcdefgh12345678";
        String basicLive = "Basic " + java.util.Base64.getEncoder()
                .encodeToString((live + ":").getBytes(java.nio.charset.StandardCharsets.UTF_8));
        issueServer.expect(requestTo("https://api.tosspayments.com/v1/billing/authorizations/issue"))
                .andExpect(header("Authorization", basicLive))
                .andRespond(withSuccess("{\"billingKey\":\"BK-L\",\"customerKey\":\"acttub_c\"}", MediaType.APPLICATION_JSON));
        TossBillingGateway liveGateway = new TossBillingGateway(() -> live, issueBuilder.build(), approveBuilder.build(), true);
        assertThat(liveGateway.issueBillingKey("AK", "acttub_c")).isEqualTo("BK-L");
        issueServer.verify();
        for (String key : new String[] {"", null, "live_ck_abcdefgh12345678", "live_sk_short"}) {
            TossBillingGateway gateway = new TossBillingGateway(() -> key, issueBuilder.build(), approveBuilder.build(), true);
            assertThatThrownBy(() -> gateway.issueBillingKey("AK", "c")).isInstanceOf(GatewayException.class)
                    .extracting(e -> ((GatewayException) e).code()).isEqualTo("secret_key_not_test");
        }
    }

    @Test
    void tossRejectionKeepsTheTossCodeOnlyAndCarriesNoSecret() {
        issueServer.expect(requestTo("https://api.tosspayments.com/v1/billing/authorizations/issue"))
                .andRespond(withStatus(HttpStatus.BAD_REQUEST).contentType(MediaType.APPLICATION_JSON)
                        .body("{\"code\":\"INVALID_CARD_NUMBER\",\"message\":\"카드 번호가 올바르지 않습니다 AK\"}"));
        assertThatThrownBy(() -> gateway(SECRET).issueBillingKey("AK", "c"))
                .isInstanceOfSatisfying(GatewayException.class, e -> {
                    assertThat(e.outcome()).isEqualTo(GatewayException.Outcome.REJECTED);
                    assertThat(e.code()).isEqualTo("INVALID_CARD_NUMBER");
                    assertThat(e.getMessage()).doesNotContain("AK", SECRET);
                });
    }

    @Test
    void approvalServerErrorAndProcessingCodesAreUnknownNotFailed() {
        approveServer.expect(requestTo("https://api.tosspayments.com/v1/billing/BK-1"))
                .andRespond(withStatus(HttpStatus.INTERNAL_SERVER_ERROR));
        assertThatThrownBy(() -> gateway(SECRET).approve("BK-1", "c", "o", 3900, "n", "i"))
                .isInstanceOfSatisfying(GatewayException.class,
                        e -> assertThat(e.outcome()).isEqualTo(GatewayException.Outcome.UNKNOWN));

        approveServer.reset();
        approveServer.expect(requestTo("https://api.tosspayments.com/v1/billing/BK-1"))
                .andRespond(withStatus(HttpStatus.BAD_REQUEST).contentType(MediaType.APPLICATION_JSON)
                        .body("{\"code\":\"FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING\",\"message\":\"x\"}"));
        assertThatThrownBy(() -> gateway(SECRET).approve("BK-1", "c", "o", 3900, "n", "i"))
                .isInstanceOfSatisfying(GatewayException.class,
                        e -> assertThat(e.outcome()).isEqualTo(GatewayException.Outcome.UNKNOWN));

        approveServer.reset();
        approveServer.expect(requestTo("https://api.tosspayments.com/v1/billing/BK-1"))
                .andRespond(withStatus(HttpStatus.BAD_REQUEST).contentType(MediaType.APPLICATION_JSON)
                        .body("{\"code\":\"REJECT_CARD_PAYMENT\",\"message\":\"한도 초과\"}"));
        assertThatThrownBy(() -> gateway(SECRET).approve("BK-1", "c", "o", 3900, "n", "i"))
                .isInstanceOfSatisfying(GatewayException.class, e -> {
                    assertThat(e.outcome()).isEqualTo(GatewayException.Outcome.REJECTED);
                    assertThat(e.code()).isEqualTo("REJECT_CARD_PAYMENT");
                });
    }

    @Test
    void timeoutBecomesUnknownAndTheErrorNeverContainsTheBillingKeyUrl() {
        approveServer.expect(requestTo("https://api.tosspayments.com/v1/billing/BK-SECRET"))
                .andRespond(request -> {
                    throw new IOException("Read timed out for https://api.tosspayments.com/v1/billing/BK-SECRET");
                });
        assertThatThrownBy(() -> gateway(SECRET).approve("BK-SECRET", "c", "o", 3900, "n", "i"))
                .isInstanceOfSatisfying(GatewayException.class, e -> {
                    assertThat(e.outcome()).isEqualTo(GatewayException.Outcome.UNKNOWN);
                    assertThat(e.getMessage()).doesNotContain("BK-SECRET");
                    assertThat(e.getCause()).isNull();
                    assertThat(e.code()).isEqualTo("gateway_unreachable");
                });
    }

    @Test
    void productionClientsUseTheDocumentedTimeouts() {
        assertThat(TossBillingGateway.APPROVE_TIMEOUT.toSeconds()).isGreaterThanOrEqualTo(60);
        assertThat(TossBillingGateway.BASE_URL).isEqualTo("https://api.tosspayments.com");
    }
}
