package com.acttub.actingapi.feature.billing.adapter.mail;

import static org.springframework.test.web.client.match.MockRestRequestMatchers.header;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.jsonPath;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.time.Instant;

import com.acttub.actingapi.feature.billing.app.BillingMailer.PaidMail;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/** Resend 호출의 모양. 실제 네트워크는 쓰지 않는다. */
class ResendBillingMailerTest {
    private final RestClient.Builder builder = RestClient.builder().baseUrl(ResendBillingMailer.BASE_URL);
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    private final ResendBillingMailer mailer = new ResendBillingMailer("re_test_key", "ACTTUB <no-reply@acttub.com>",
            builder.build(), Runnable::run);
    private final PaidMail mail = new PaidMail("actor@example.com", "QAtest", true, "pro-first-1", 3900, "하나",
            "53183800****5678", Instant.parse("2026-11-01T06:52:12Z"), Instant.parse("2026-11-01T06:52:12Z"),
            Instant.parse("2026-12-01T06:52:12Z"), com.acttub.actingapi.feature.billing.app.BillingRules.Plan.MONTHLY);

    @Test
    @DisplayName("주문 번호를 멱등 키로 Resend 에 한 번 보낸다")
    void postsOnceWithTheOrderAsIdempotencyKey() {
        server.expect(requestTo("https://api.resend.com/emails"))
                .andExpect(method(HttpMethod.POST))
                .andExpect(header("Authorization", "Bearer re_test_key"))
                .andExpect(header("Idempotency-Key", "billing-mail/pro-first-1"))
                .andExpect(jsonPath("$.from").value("ACTTUB <no-reply@acttub.com>"))
                .andExpect(jsonPath("$.to[0]").value("actor@example.com"))
                .andExpect(jsonPath("$.subject").value("Pro 구독을 시작했어요 · 3,900원 결제 완료"))
                .andExpect(jsonPath("$.reply_to").value("acttub0527@gmail.com"))
                .andRespond(withSuccess("{\"id\":\"e1\"}", MediaType.APPLICATION_JSON));
        mailer.paymentDone(mail);
        server.verify();
    }

    @Test
    @DisplayName("Resend 가 거절(4xx)해도, 실행기가 일을 받지 못해도 예외를 밖으로 던지지 않는다")
    void swallowsRejectionsAndQueueFailures() {
        server.expect(requestTo("https://api.resend.com/emails"))
                .andRespond(org.springframework.test.web.client.response.MockRestResponseCreators.withStatus(
                        org.springframework.http.HttpStatus.UNPROCESSABLE_ENTITY));
        mailer.paymentDone(mail);
        server.verify();
        new ResendBillingMailer("re_test_key", "f", builder.build(), task -> {
            throw new java.util.concurrent.RejectedExecutionException("full");
        }).paymentDone(mail);
        new ResendBillingMailer("re_test_key", "ACTTUB <no-reply@acttub.com>");
    }

    @Test
    @DisplayName("Resend 가 실패해도 예외를 밖으로 던지지 않는다")
    void swallowsFailures() {
        server.expect(requestTo("https://api.resend.com/emails")).andRespond(withServerError());
        mailer.paymentDone(mail);
        server.verify();
    }
}
