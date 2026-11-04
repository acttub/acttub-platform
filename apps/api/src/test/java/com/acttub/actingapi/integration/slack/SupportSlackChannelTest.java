package com.acttub.actingapi.integration.slack;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.content;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.method;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withServerError;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

class SupportSlackChannelTest {
    private static final String HOOK = "https://hooks.slack.com/services/T/B/x";

    @Test
    void postsTextAndSwallowsFailures() throws Exception {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        server.expect(requestTo(HOOK)).andExpect(method(HttpMethod.POST))
                .andExpect(content().string(org.hamcrest.Matchers.containsString("첫 번째")))
                .andRespond(withSuccess());
        server.expect(requestTo(HOOK)).andRespond(withServerError());
        ExecutorService sender = Executors.newSingleThreadExecutor();
        SupportSlackChannel channel = new SupportSlackChannel(HOOK, builder, sender);
        channel.post("첫 번째", "test");
        channel.post("두 번째", "test");
        sender.shutdown();
        assertThat(sender.awaitTermination(5, TimeUnit.SECONDS)).isTrue();
        server.verify();
    }

    @Test
    void onlySlackHooksAreEnabled() {
        assertThat(new SupportSlackChannel("", RestClient.builder(), Executors.newSingleThreadExecutor()).enabled()).isFalse();
        assertThat(new SupportSlackChannel("https://example.com/x", RestClient.builder(), Executors.newSingleThreadExecutor()).enabled())
                .isFalse();
        assertThat(new SupportSlackChannel(" " + HOOK + "\n", RestClient.builder(), Executors.newSingleThreadExecutor()).enabled())
                .isTrue();
    }

    @Test
    void quoteCutsByCodePointAndQuotesEveryLine() {
        assertThat(SupportSlackChannel.quote("한 줄\n두 줄", 100)).isEqualTo("> 한 줄\n> 두 줄");
        assertThat(SupportSlackChannel.quote("😀".repeat(5), 3)).isEqualTo("> " + "😀".repeat(3) + "…");
        assertThat(SupportSlackChannel.quote(null, 3)).isEqualTo("> ");
    }
}
