package com.acttub.actingapi.feature.support.adapter.slack;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import com.acttub.actingapi.feature.support.app.SupportInquiryNotifier.Notice;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class SlackSupportInquiryNotifierTest {
    private static final String HOOK = "https://hooks.slack.com/services/T/B/x";
    private static final UUID ID = UUID.fromString("00000000-0000-0000-0000-000000000001");

    @Test
    void reportIsMarkedAndBodyIsQuotedWithoutEmail() {
        String text = SlackSupportInquiryNotifier.message(new Notice(ID, "report", "욕설 댓글이 있어요\n두 번째 줄", true, "1.1.1"));
        assertThat(text).startsWith("*[신고] 24시간 안에 처리*");
        assertThat(text).contains("회원 · 앱 1.1.1").contains("> 욕설 댓글이 있어요\n> 두 번째 줄").contains(ID.toString());
        assertThat(text).doesNotContain("@");
    }

    @Test
    void otherCategoriesUseKoreanLabelAndLongBodyIsCut() {
        String text = SlackSupportInquiryNotifier.message(new Notice(ID, "usage", "가".repeat(600), false, null));
        assertThat(text).startsWith("*[사용 문의]*").contains("비회원 · 웹").contains("…");
        assertThat(text).doesNotContain("가".repeat(501));
    }

    @Test
    void postsToWebhookAndSwallowsFailures() throws Exception {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo(HOOK)).andExpect(method(HttpMethod.POST))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("새 문의가 들어왔어요")))
                .andRespond(withSuccess());
        server.expect(requestTo(HOOK)).andRespond(withServerError());
        ExecutorService sender = Executors.newSingleThreadExecutor();
        SlackSupportInquiryNotifier notifier = new SlackSupportInquiryNotifier(HOOK, builder, sender);
        notifier.accepted(new Notice(ID, "bug", "앱이 꺼져요 열 글자 이상", true, "1.1.1"));
        notifier.accepted(new Notice(ID, "bug", "두 번째도 열 글자 이상", true, "1.1.1"));
        sender.shutdown();
        assertThat(sender.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        server.verify();
    }

    @Test
    void doesNothingWithoutWebhook() {
        SlackSupportInquiryNotifier notifier = new SlackSupportInquiryNotifier("", RestClient.builder(), Executors.newSingleThreadExecutor());
        assertThat(notifier.enabled()).isFalse();
        notifier.accepted(new Notice(ID, "other", "아무 일도 없어야 해요", false, null));
    }
}
