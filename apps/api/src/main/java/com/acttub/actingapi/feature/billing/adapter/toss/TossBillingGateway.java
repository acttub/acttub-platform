package com.acttub.actingapi.feature.billing.adapter.toss;

import java.net.http.HttpClient;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.billing.app.PgReviewGateway;
import com.acttub.actingapi.feature.billing.app.PgReviewSettings;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * 토스페이먼츠 자동결제(빌링) API 의 실물. 개별 연동 <b>테스트</b> 시크릿 키({@code test_sk_})만 쓰고, 호출 직전에도
 * 다시 검사한다. 일반 결제 승인({@code /v1/payments/confirm})은 쓰지 않는다.
 *
 * <p><b>비밀 값 규칙</b>: authKey·billingKey·시크릿 키는 예외 메시지·로그에 싣지 않는다. 승인 URL 에 빌링키가 들어
 * 있어 {@link RestClientException} 의 메시지가 URL 을 싣기 때문에, 그 예외는 원인을 붙이지 않고 코드만 가진
 * {@link GatewayException} 으로 바꿔 던진다.
 */
public class TossBillingGateway implements PgReviewGateway {
    public static final String BASE_URL = "https://api.tosspayments.com";
    /** 공식 문서가 승인 API 의 최소 응답 대기를 60초로 안내한다. */
    static final Duration APPROVE_TIMEOUT = Duration.ofSeconds(65);
    static final Duration ISSUE_TIMEOUT = Duration.ofSeconds(15);
    private static final Duration CONNECT_TIMEOUT = Duration.ofSeconds(5);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Pattern CODE = Pattern.compile("[A-Z0-9_]{1,64}");
    /** 토스가 "처리 결과를 모른다/처리 중"이라고 말하는 코드 — 실패로 단정하지 않는다. */
    private static final Set<String> UNKNOWN_CODES = Set.of(
            "FAILED_INTERNAL_SYSTEM_PROCESSING",
            "FAILED_PAYMENT_INTERNAL_SYSTEM_PROCESSING",
            "UNKNOWN_PAYMENT_ERROR",
            "PROVIDER_ERROR",
            "IDEMPOTENT_REQUEST_PROCESSING");

    private final Supplier<String> secretKey;
    private final RestClient issueHttp;
    private final RestClient approveHttp;

    public TossBillingGateway(Supplier<String> secretKey) {
        this(secretKey, client(BASE_URL, ISSUE_TIMEOUT), client(BASE_URL, APPROVE_TIMEOUT));
    }

    /** 테스트가 가짜 서버가 묶인 클라이언트를 끼운다. */
    public TossBillingGateway(Supplier<String> secretKey, RestClient issueHttp, RestClient approveHttp) {
        this.secretKey = secretKey;
        this.issueHttp = issueHttp;
        this.approveHttp = approveHttp;
    }

    private static RestClient client(String baseUrl, Duration read) {
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(HttpClient.newBuilder()
                .version(HttpClient.Version.HTTP_1_1)
                .followRedirects(HttpClient.Redirect.NEVER)
                .connectTimeout(CONNECT_TIMEOUT)
                .build());
        factory.setReadTimeout(read);
        return RestClient.builder().baseUrl(baseUrl).requestFactory(factory).build();
    }

    @Override
    public String issueBillingKey(String authKey, String customerKey) {
        return issue(authKey, customerKey).billingKey();
    }

    /** 응답의 {@code cardCompany}·{@code cardNumber}(가린 번호)를 함께 읽는다. 없으면 {@code null}. */
    @Override
    public IssuedKey issue(String authKey, String customerKey) {
        String authorization = authorization();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("authKey", authKey);
        body.put("customerKey", customerKey);
        Reply reply = send(issueHttp, "/v1/billing/authorizations/issue", authorization, body, null);
        if (reply.status() / 100 != 2) {
            throw rejected(reply, "billing_key_failed");
        }
        String billingKey = reply.json().path("billingKey").asText("");
        if (billingKey.isBlank()) {
            throw new GatewayException(GatewayException.Outcome.REJECTED, "billing_key_missing");
        }
        JsonNode json = reply.json();
        String company = json.path("cardCompany").isTextual() ? json.path("cardCompany").asText() : null;
        String number = json.path("cardNumber").isTextual()
                ? json.path("cardNumber").asText()
                : (json.path("card").path("number").isTextual() ? json.path("card").path("number").asText() : null);
        return new IssuedKey(billingKey, shortText(company), shortText(number));
    }

    @Override
    public Approval approve(String billingKey, String customerKey, String orderId, long amount, String orderName,
            String idempotencyKey) {
        String authorization = authorization();
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("customerKey", customerKey);
        body.put("amount", amount);
        body.put("orderId", orderId);
        body.put("orderName", orderName);
        Reply reply = send(approveHttp, "/v1/billing/" + billingKey, authorization, body, idempotencyKey);
        if (reply.status() / 100 == 5) {
            throw new GatewayException(GatewayException.Outcome.UNKNOWN, "gateway_server_error");
        }
        if (reply.status() / 100 != 2) {
            throw rejected(reply, "approval_failed");
        }
        JsonNode json = reply.json();
        JsonNode total = json.has("totalAmount") ? json.get("totalAmount") : json.path("amount");
        return new Approval(
                json.path("status").asText(""),
                json.path("orderId").asText(""),
                total.isNumber() ? total.asLong() : -1L,
                json.path("approvedAt").isTextual() ? json.path("approvedAt").asText() : null);
    }

    private String authorization() {
        String key = secretKey.get();
        // 설정 검사를 통과했더라도 호출 직전에 다시 본다 — 라이브 키로는 어떤 요청도 보내지 않는다.
        if (!PgReviewSettings.isTestSecretKey(key)) {
            throw new GatewayException(GatewayException.Outcome.REJECTED, "secret_key_not_test");
        }
        return "Basic " + Base64.getEncoder().encodeToString((key + ":").getBytes(StandardCharsets.UTF_8));
    }

    private Reply send(RestClient http, String path, String authorization, Map<String, Object> body,
            String idempotencyKey) {
        try {
            RestClient.RequestBodySpec request = http.post()
                    .uri(path)
                    .header("Authorization", authorization)
                    .contentType(MediaType.APPLICATION_JSON);
            if (idempotencyKey != null) {
                request = request.header("Idempotency-Key", idempotencyKey);
            }
            return request.body(JSON.writeValueAsString(body)).exchange((sent, response) -> new Reply(
                    response.getStatusCode().value(),
                    new String(response.getBody().readAllBytes(), StandardCharsets.UTF_8)));
        } catch (RestClientException | com.fasterxml.jackson.core.JsonProcessingException failure) {
            // 원인을 붙이지 않는다: 메시지에 빌링키가 든 URL 이 실린다.
            throw new GatewayException(GatewayException.Outcome.UNKNOWN, "gateway_unreachable");
        }
    }

    /** 표시용 짧은 글만 받는다(카드사 이름·가린 번호). 그 밖에는 버린다. */
    private static String shortText(String value) {
        if (value == null || value.isBlank() || value.length() > 40) {
            return null;
        }
        return value.matches("[\\p{L}0-9*\\- ]+") ? value : null;
    }

    private static GatewayException rejected(Reply reply, String fallbackCode) {
        String code = reply.json().path("code").asText("");
        if (!CODE.matcher(code).matches()) {
            code = fallbackCode;
        }
        GatewayException.Outcome outcome =
                UNKNOWN_CODES.contains(code) ? GatewayException.Outcome.UNKNOWN : GatewayException.Outcome.REJECTED;
        return new GatewayException(outcome, code);
    }

    private record Reply(int status, String body) {
        JsonNode json() {
            try {
                return JSON.readTree(body == null || body.isBlank() ? "{}" : body);
            } catch (Exception notJson) {
                return JSON.createObjectNode();
            }
        }
    }
}
