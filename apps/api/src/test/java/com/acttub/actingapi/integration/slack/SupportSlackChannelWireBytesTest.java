package com.acttub.actingapi.integration.slack;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.client.match.MockRestRequestMatchers.requestTo;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.platform.http.RestClients;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.http.client.MockClientHttpRequest;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.web.client.RestClient;

/**
 * Slack 웹후크로 나가는 요청 본문과 Content-Type 을 바이트 그대로 고정한다. 이 본문은 우리 코드가 아니라 RestClient 의 JSON
 * 변환기가 맵을 직렬화한 것이라, JSON 라이브러리를 바꾸면 가장 먼저 달라질 수 있는 자리다.
 */
class SupportSlackChannelWireBytesTest {
    private static final String HOOK = "https://hooks.slack.com/services/T000/B000/not-a-real-hook";
    /** 한글, 따옴표, 빗금, 역빗금, 줄바꿈, 탭, 제어 문자, 이모지. */
    private static final String TRICKY = "따옴표\"와 빗금/와 역빗금\\ 줄\n탭\t제어\u001f 이모지😀";

    @Test
    @DisplayName("글 하나를 text 키 하나로 싣고 특수 문자와 이모지를 정해진 바이트로 쓴다")
    void textBody() throws Exception {
        RestClient.Builder builder = RestClients.builder();
        MockRestServiceServer server = MockRestServiceServer.bindTo(builder).build();
        List<byte[]> bodies = new ArrayList<>();
        List<String> contentTypes = new ArrayList<>();
        server.expect(requestTo(HOOK))
                .andExpect(request -> {
                    contentTypes.add(request.getHeaders().getFirst("Content-Type"));
                    bodies.add(((MockClientHttpRequest) request).getBodyAsBytes());
                })
                .andRespond(withSuccess());
        ExecutorService sender = Executors.newSingleThreadExecutor();
        SupportSlackChannel channel = new SupportSlackChannel(HOOK, builder, sender);

        channel.post("*새 문의*\n" + SupportSlackChannel.quote(TRICKY, 100), "test");
        sender.shutdown();
        assertThat(sender.awaitTermination(5, TimeUnit.SECONDS)).isTrue();

        server.verify();
        assertThat(contentTypes).containsExactly("application/json");
        // 이모지는 지금 서로게이트 쌍 이스케이프로 나간다(맵을 바이트로 바로 쓰는 경로).
        assertThat(bodies.getFirst()).asString(StandardCharsets.UTF_8).isEqualTo("""
                {"text":"*새 문의*\\n> 따옴표\\"와 빗금/와 역빗금\\\\ 줄\\n> 탭\\t제어\\u001F 이모지\\uD83D\\uDE00"}""");
    }
}
