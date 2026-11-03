package com.acttub.actingapi.feature.support.adapter.slack;

import com.acttub.actingapi.feature.support.app.SupportInquiryNotifier;
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
 * 새 문의·신고·의견을 Slack 「#문의-신고」 채널에 올린다(Incoming Webhook, SUPPORT_SLACK_WEBHOOK_URL).
 * 주소가 없으면(로컬·테스트) 아무것도 하지 않는다. 접수 응답을 늦추지 않게 따로 보내고, 실패는 로그만 남긴다.
 * 웹후크 주소·메일 주소는 로그에도 메시지에도 싣지 않는다. 본문은 앞 {@value #BODY_PREVIEW_CHARS}자만 싣는다.
 */
@Component
public class SlackSupportInquiryNotifier implements SupportInquiryNotifier {
    static final int BODY_PREVIEW_CHARS = 500;
    private static final Duration TIMEOUT = Duration.ofSeconds(5);
    private static final Logger log = LoggerFactory.getLogger(SlackSupportInquiryNotifier.class);
    private static final Map<String, String> LABELS = Map.of(
            "report", "신고", "usage", "사용 문의", "bug", "오류", "billing", "결제",
            "refund", "환불", "account", "계정", "other", "기타", "feedback", "의견");

    private final String webhookUrl;
    private final RestClient http;
    private final ExecutorService sender;

    @Autowired
    public SlackSupportInquiryNotifier(@Value("${SUPPORT_SLACK_WEBHOOK_URL:}") String webhookUrl) {
        this(webhookUrl, builder(), Executors.newSingleThreadExecutor(r -> {
            Thread t = new Thread(r, "support-slack");
            t.setDaemon(true);
            return t;
        }));
    }

    SlackSupportInquiryNotifier(String webhookUrl, RestClient.Builder http, ExecutorService sender) {
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

    boolean enabled() {
        return webhookUrl.startsWith("https://hooks.slack.com/");
    }

    @Override
    public void accepted(Notice notice) {
        if (!enabled() || notice == null) {
            return;
        }
        String text = message(notice);
        try {
            sender.execute(() -> post(text, notice));
        } catch (RuntimeException e) {
            log.warn("support slack notify skipped id={} reason={}", notice.id(), e.getClass().getSimpleName());
        }
    }

    private void post(String text, Notice notice) {
        try {
            http.post().uri(webhookUrl).contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of("text", text)).retrieve().toBodilessEntity();
        } catch (RuntimeException e) {
            log.warn("support slack notify failed id={} reason={}", notice.id(), e.getClass().getSimpleName());
        }
    }

    /** 첫 줄에 분류(신고는 맨 앞에 표시), 다음 줄에 보낸 곳, 그 아래 본문 앞부분, 마지막에 문의 id. */
    static String message(Notice n) {
        String label = LABELS.getOrDefault(n.category(), n.category());
        boolean report = "report".equals(n.category());
        String from = (n.member() ? "회원" : "비회원") + (n.client() == null || n.client().isBlank() ? " · 웹" : " · 앱 " + n.client());
        String body = n.body() == null ? "" : n.body();
        int[] cps = body.codePoints().toArray();
        String preview = cps.length > BODY_PREVIEW_CHARS
                ? new String(cps, 0, BODY_PREVIEW_CHARS) + "…"
                : body;
        String quoted = "> " + preview.replace("\n", "\n> ");
        return (report ? "*[신고] 24시간 안에 처리*" : "*[" + label + "]*") + " 새 문의가 들어왔어요\n"
                + from + "\n" + quoted + "\n문의 id `" + n.id() + "`";
    }
}
