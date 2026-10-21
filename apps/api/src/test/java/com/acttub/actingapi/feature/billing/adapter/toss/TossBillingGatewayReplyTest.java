package com.acttub.actingapi.feature.billing.adapter.toss;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.acttub.actingapi.feature.billing.app.PgReviewGateway;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** 토스가 문서와 다르게 답할 때 — 빈 빌링키, 금액 칸 이름, 읽을 수 없는 오류 본문. */
class TossBillingGatewayReplyTest {
    private static final String SECRET = "test_sk_abcdefgh12345678";

    private final RestClient.Builder issueBuilder = RestClient.builder().baseUrl(TossBillingGateway.BASE_URL);
    private final RestClient.Builder approveBuilder = RestClient.builder().baseUrl(TossBillingGateway.BASE_URL);
    private final MockRestServiceServer issueServer = MockRestServiceServer.bindTo(issueBuilder).build();
    private final MockRestServiceServer approveServer = MockRestServiceServer.bindTo(approveBuilder).build();

    private TossBillingGateway gateway() {
        return new TossBillingGateway(() -> SECRET, issueBuilder.build(), approveBuilder.build());
    }

    @Test
    void issueAnswerWithoutABillingKeyIsRejected() {
        issueServer.expect(request -> { }).andRespond(withSuccess("{\"customerKey\":\"pgr_c\"}", MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> gateway().issueBillingKey("AK", "pgr_c"))
                .isInstanceOfSatisfying(PgReviewGateway.GatewayException.class, failure -> {
                    assertThat(failure.outcome()).isEqualTo(PgReviewGateway.GatewayException.Outcome.REJECTED);
                    assertThat(failure.code()).isEqualTo("billing_key_missing");
                });
    }

    @Test
    void approvalReadsAmountWhenTotalAmountIsAbsentAndToleratesMissingFields() {
        approveServer.expect(request -> { }).andRespond(withSuccess(
                "{\"status\":\"DONE\",\"orderId\":\"pgr-o\",\"amount\":3900,\"approvedAt\":7}", MediaType.APPLICATION_JSON));
        approveServer.expect(request -> { }).andRespond(withSuccess("", MediaType.APPLICATION_JSON));

        PgReviewGateway.Approval withAmount = gateway().approve("BK", "pgr_c", "pgr-o", 3900, "구독", "idem");
        PgReviewGateway.Approval empty = gateway().approve("BK", "pgr_c", "pgr-o", 3900, "구독", "idem");

        assertThat(withAmount).isEqualTo(new PgReviewGateway.Approval("DONE", "pgr-o", 3900, null));
        assertThat(empty).isEqualTo(new PgReviewGateway.Approval("", "", -1, null));
    }

    @Test
    void rejectionWithAnUnreadableOrOddCodeFallsBackToOurCode() {
        issueServer.expect(request -> { }).andRespond(withStatus(HttpStatus.BAD_REQUEST)
                .body("<html>bad</html>").contentType(MediaType.TEXT_HTML));
        approveServer.expect(request -> { }).andRespond(withStatus(HttpStatus.BAD_REQUEST)
                .body("{\"code\":\"bad code with spaces\"}").contentType(MediaType.APPLICATION_JSON));

        assertThatThrownBy(() -> gateway().issueBillingKey("AK", "pgr_c"))
                .isInstanceOfSatisfying(PgReviewGateway.GatewayException.class,
                        failure -> assertThat(failure.code()).isEqualTo("billing_key_failed"));
        assertThatThrownBy(() -> gateway().approve("BK", "pgr_c", "pgr-o", 3900, "구독", "idem"))
                .isInstanceOfSatisfying(PgReviewGateway.GatewayException.class,
                        failure -> assertThat(failure.code()).isEqualTo("approval_failed"));
    }
}
