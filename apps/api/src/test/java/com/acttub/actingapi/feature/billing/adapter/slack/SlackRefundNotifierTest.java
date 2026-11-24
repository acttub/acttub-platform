package com.acttub.actingapi.feature.billing.adapter.slack;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.acttub.actingapi.feature.billing.app.RefundNotifier.Refund;
import com.acttub.actingapi.integration.slack.SupportSlackChannel;
import com.acttub.actingapi.platform.http.RestClients;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class SlackRefundNotifierTest {
    private static final String HOOK = "https://hooks.slack.com/services/T/B/x";
    private static final String ORDER = "pro-first-0f8e3c1a2b4d4e6f8a9b0c1d2e3f4a5b";

    @Test
    void namesTheOrderAndAmountAsARefundWithoutMemberDetails() {
        String text = SlackRefundNotifier.message(new Refund(ORDER, 32500));
        assertThat(text).startsWith("*[결제 · 환불 대상]*").contains("토스 관리자에서 이 주문을 환불해 주세요")
                .contains("금액 32,500원").contains("주문 id `" + ORDER + "`");
        assertThat(text).doesNotContain("@");
    }

    @Test
    void postsToWebhookAndSwallowsFailures() throws Exception {
        RestClient.Builder builder = RestClients.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo(HOOK)).andExpect(method(HttpMethod.POST))
                .andExpect(content().string(org.hamcrest.Matchers.containsString(ORDER)))
                .andRespond(withSuccess());
        server.expect(requestTo(HOOK)).andRespond(withServerError());
        ExecutorService sender = Executors.newSingleThreadExecutor();
        SlackRefundNotifier notifier = new SlackRefundNotifier(new SupportSlackChannel(HOOK, builder, sender));
        notifier.refundNeeded(new Refund(ORDER, 3900));
        notifier.refundNeeded(new Refund(ORDER, 3900));
        sender.shutdown();
        assertThat(sender.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        server.verify();
    }

    @Test
    void doesNothingWithoutWebhook() {
        SupportSlackChannel channel = new SupportSlackChannel("", RestClients.builder(), Executors.newSingleThreadExecutor());
        new SlackRefundNotifier(channel).refundNeeded(new Refund(ORDER, 3900));
        assertThat(channel.enabled()).isFalse();
    }
}
