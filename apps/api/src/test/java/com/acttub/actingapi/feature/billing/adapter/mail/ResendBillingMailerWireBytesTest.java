package com.acttub.actingapi.feature.billing.adapter.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import com.acttub.actingapi.feature.billing.app.BillingMailer.PaidMail;
import com.acttub.actingapi.feature.billing.app.BillingRules;
import com.acttub.actingapi.platform.http.RestClients;
import com.acttub.actingapi.support.FrozenValue;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/**
 * Resend 로 나가는 구독 메일 요청 본문을 바이트 그대로 고정한다. JSON 라이브러리를 바꿔도 같은 바이트가 나가야 한다.
 * 기대값은 {@code frozen/wire-bytes/resend-billing-mail.json} 이고 마지막에 줄바꿈이 없다.
 */
class ResendBillingMailerWireBytesTest {
    /** 한글, 따옴표, 빗금, 역빗금, 줄바꿈, 탭, 제어 문자, 이모지. */
    private static final String TRICKY = "따옴표\"와 빗금/와 역빗금\\ 줄\n탭\t제어\u001f 이모지😀";

    private final RestClient.Builder builder = RestClients.builder().baseUrl(ResendBillingMailer.BASE_URL);
    private final MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
    private final List<byte[]> sent = new ArrayList<>();

    @Test
    @DisplayName("구독 메일 본문은 from, to, subject, html, text, reply_to 순서이고 HTML 과 글의 특수 문자를 같게 이스케이프한다")
    void paidMailBody() {
        server.expect(requestTo("https://api.resend.com/emails"))
                .andExpect(request -> sent.add(((MockClientHttpRequest) request).getBodyAsBytes()))
                .andRespond(withSuccess("{\"id\":\"e1\"}", MediaType.APPLICATION_JSON));
        ResendBillingMailer mailer = new ResendBillingMailer("re_test_key", "ACTTUB <no-reply@acttub.com>",
                builder.build(), Runnable::run);

        mailer.paymentDone(new PaidMail("actor@example.com", TRICKY, true, "pro-first-1", 1_234_567, "하나",
                "53183800****5678", Instant.parse("2026-11-01T06:52:12.123456789Z"),
                Instant.parse("2026-11-01T06:52:12Z"), Instant.parse("2027-11-01T06:52:12Z"), BillingRules.Plan.YEARLY));

        server.verify();
        assertThat(sent.getFirst()).asString(StandardCharsets.UTF_8)
                .isEqualTo(FrozenValue.of("wire-bytes/resend-billing-mail.json"));
    }
}
