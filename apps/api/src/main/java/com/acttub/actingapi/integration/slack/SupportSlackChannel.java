package com.acttub.actingapi.integration.slack;

import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Slack 「#문의-신고」 채널에 글을 올린다(Incoming Webhook, SUPPORT_SLACK_WEBHOOK_URL). 문의(SOMA-1032)와 앱 안
 * 신고(SOMA-1042)가 같은 채널을 쓴다. 주소가 없으면(로컬·테스트) 아무것도 하지 않는다. 요청을 늦추지 않게 따로 보내고,
 * 실패는 로그만 남긴다 — 이 클래스는 예외를 밖으로 던지지 않는다. 웹후크 주소는 로그에 싣지 않는다.
 */
@Component
public class SupportSlackChannel {
    private static final Duration TIMEOUT = Duration.ofSeconds(5);
    private static final Logger log = LoggerFactory.getLogger(SupportSlackChannel.class);

    private final String webhookUrl;
    private final RestClient http;
    private final ExecutorService sender;

    @Autowired
    public SupportSlackChannel(@Value("${SUPPORT_SLACK_WEBHOOK_URL:}") String webhookUrl) {
        this(webhookUrl, builder(), Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "support-slack");
            t.setDaemon(true);
            return t;
        }));
    }

    public SupportSlackChannel(String webhookUrl, RestClient.Builder http, ExecutorService sender) {
        this.webhookUrl = webhookUrl == null ? "" : webhookUrl.strip();
        this.http = http.build();
        this.sender = sender;
    }

    private static RestClient.Builder builder() {
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(TIMEOUT)
                .build());
        factory.setReadTimeout(TIMEOUT);
        return RestClient.builder().requestFactory(factory);
    }

    public boolean enabled() {
        return webhookUrl.startsWith("https://hooks.slack.com/");
    }

    /** {@code what} 은 로그에만 쓰는 짧은 표시(예: {@code inquiry id=…}). 개인정보를 넣지 않는다. */
    public void post(String text, String what) {
        if (!enabled() || text == null) {
            return;
        }
        try {
            sender.execute(() -> send(text, what));
        } catch (RuntimeException e) {
            log.warn("support slack notify skipped {} reason={}", what, e.getClass().getSimpleName());
        }
    }

    private void send(String text, String what) {
        try {
            http.post().uri(webhookUrl).contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("text", text)).retrieve().toBodilessEntity();
        } catch (RuntimeException e) {
            log.warn("support slack notify failed {} reason={}", what, e.getClass().getSimpleName());
        }
    }

    /** 앞 {@code max} 글자(코드포인트)만 남기고 잘렸으면 「…」를 붙인 뒤, 줄마다 Slack 인용(>)을 붙인다. */
    public static String quote(String text, int max) {
        String body = text == null ? "" : text.strip();
        int[] cps = body.codePoints().toArray();
        String preview = cps.length > max ? new String(cps, 0, max) + "…" : body;
        return "> " + preview.replace("\n", "\n> ");
    }
}
