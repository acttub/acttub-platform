package com.acttub.actingapi.feature.billing.adapter.mail;

import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.Executor;
import java.util.concurrent.Executors;

import com.acttub.actingapi.feature.billing.app.BillingMailer;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * Resend 로 구독 메일을 보낸다(SOMA-961). 결제 요청을 붙잡지 않도록 따로 된 스레드 하나에서 보내고, 실패는 로그 한 줄만 남긴다
 * (받는 주소·키는 싣지 않는다). 같은 주문은 {@code Idempotency-Key} 로 한 번만 나간다.
 */
public class ResendBillingMailer implements BillingMailer {
    private static final Logger LOG = LoggerFactory.getLogger(ResendBillingMailer.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    static final String BASE_URL = "https://api.resend.com";

    private final String apiKey;
    private final String from;
    private final RestClient http;
    private final Executor executor;

    public ResendBillingMailer(String apiKey, String from) {
        this(apiKey, from, client(BASE_URL), Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "billing-mail");
            thread.setDaemon(true);
            return thread;
        }));
    }

    /** 테스트가 가짜 서버가 묶인 클라이언트와 바로 실행하는 실행기를 끼운다. */
    ResendBillingMailer(String apiKey, String from, RestClient http, Executor executor) {
        this.apiKey = apiKey;
        this.from = from;
        this.http = http;
        this.executor = executor;
    }

    @Override
    public void paymentDone(PaidMail mail) {
        try {
            executor.execute(() -> send(mail));
        } catch (RuntimeException e) {
            LOG.warn("billing_mail_queue_failed order={}", mail.orderId());
        }
    }

    void send(PaidMail mail) {
        try {
            SubscriptionMailTemplate.Rendered rendered = SubscriptionMailTemplate.render(mail);
            Map<String, Object> body = new LinkedHashMap<>();
            body.put("from", from);
            body.put("to", List.of(mail.to()));
            body.put("subject", rendered.subject());
            body.put("html", rendered.html());
            body.put("text", rendered.text());
            body.put("reply_to", "acttub0527@gmail.com");
            int status = http.post()
                    .uri("/emails")
                    .header("Authorization", "Bearer " + apiKey)
                    .header("Idempotency-Key", "billing-mail/" + mail.orderId())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(JSON.writeValueAsString(body).getBytes(StandardCharsets.UTF_8))
                    .exchange((request, response) -> response.getStatusCode().value());
            if (status / 100 == 2) {
                LOG.info("billing_mail_sent order={} first={}", mail.orderId(), mail.first());
            } else {
                LOG.warn("billing_mail_rejected order={} status={}", mail.orderId(), status);
            }
        } catch (Exception e) {
            LOG.warn("billing_mail_failed order={} error={}", mail.orderId(), e.getClass().getSimpleName());
        }
    }

    private static RestClient client(String baseUrl) {
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .followRedirects(HttpClient.Redirect.NEVER)
                .connectTimeout(Duration.ofSeconds(5))
                .build());
        factory.setReadTimeout(Duration.ofSeconds(10));
        return RestClient.builder().baseUrl(baseUrl).requestFactory(factory).build();
    }
}
