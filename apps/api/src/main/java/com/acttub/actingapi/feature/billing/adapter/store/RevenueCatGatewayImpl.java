package com.acttub.actingapi.feature.billing.adapter.store;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.format.DateTimeParseException;
import java.util.Iterator;
import java.util.Map;
import java.util.Optional;

import com.acttub.actingapi.feature.billing.app.StoreGateways.RevenueCatGateway;
import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreException;
import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreSubscription;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * RevenueCat REST API v1 의 {@code GET /v1/subscribers/{app_user_id}}(비밀 키 Bearer)로 고객 정보를 읽어, 우리 entitlement 를 준 구독
 * 하나를 꺼낸다(SOMA-818 2단계). 비밀 키·사용자 ID 는 로그와 예외에 싣지 않는다.
 *
 * <p>응답 모양(공식 Customer Info 모델): {@code subscriber.entitlements.<id>} 에 {@code product_identifier}·{@code expires_date}·
 * {@code grace_period_expires_date}·{@code purchase_date}, {@code subscriber.subscriptions.<product>} 에 {@code store}·
 * {@code unsubscribe_detected_at}·{@code billing_issues_detected_at}·{@code refunded_at}·{@code is_sandbox}·
 * {@code store_transaction_id}. 날짜는 ISO 8601 이다. Google 상품은 {@code 구독ID:기본요금제ID} 꼴일 수 있어 앞부분으로 맞춘다.
 */
public class RevenueCatGatewayImpl implements RevenueCatGateway {
    private static final Logger LOG = LoggerFactory.getLogger(RevenueCatGatewayImpl.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    static final String DEFAULT_API = "https://api.revenuecat.com";

    private final String secretKey;
    private final String entitlementId;
    private final String apiBase;
    private final HttpClient http;

    public RevenueCatGatewayImpl(String secretKey, String entitlementId) {
        this(secretKey, entitlementId, DEFAULT_API);
    }

    RevenueCatGatewayImpl(String secretKey, String entitlementId, String apiBase) {
        if (secretKey == null || secretKey.isBlank()) {
            throw new IllegalArgumentException("REVENUECAT_SECRET_API_KEY missing");
        }
        if (entitlementId == null || entitlementId.isBlank()) {
            throw new IllegalArgumentException("REVENUECAT_ENTITLEMENT_ID missing");
        }
        this.secretKey = secretKey.strip();
        this.entitlementId = entitlementId.strip();
        this.apiBase = apiBase;
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }

    @Override
    public boolean configured() {
        return true;
    }

    @Override
    public Optional<StoreSubscription> entitlement(String appUserId) {
        String url = apiBase + "/v1/subscribers/" + URLEncoder.encode(appUserId, StandardCharsets.UTF_8).replace("+", "%20");
        HttpResponse<String> response;
        try {
            response = http.send(HttpRequest.newBuilder(URI.create(url))
                    .timeout(Duration.ofSeconds(10))
                    .header("Authorization", "Bearer " + secretKey)
                    .header("Accept", "application/json")
                    .GET().build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        } catch (IOException | InterruptedException failure) {
            if (failure instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            LOG.warn("revenuecat subscriber request failed reason={}", failure.getClass().getSimpleName());
            throw new StoreException(StoreException.Kind.UPSTREAM, "store_upstream_error");
        }
        int status = response.statusCode();
        if (status == 404) {
            return Optional.empty();
        }
        if (status == 401 || status == 403) {
            LOG.error("revenuecat rejected the secret api key status={}", status);
            throw new StoreException(StoreException.Kind.UNAVAILABLE, "store_unavailable");
        }
        if (status != 200 && status != 201) {
            LOG.warn("revenuecat subscriber request failed status={}", status);
            throw new StoreException(StoreException.Kind.UPSTREAM, "store_upstream_error");
        }
        try {
            return parse(JSON.readTree(response.body()), entitlementId);
        } catch (IOException malformed) {
            throw new StoreException(StoreException.Kind.UPSTREAM, "store_upstream_error");
        }
    }

    /** 고객 정보 응답에서 entitlement 를 준 구독을 꺼낸다(순수 함수). entitlement 가 없으면 비어 있다. */
    static Optional<StoreSubscription> parse(JsonNode body, String entitlementId) {
        JsonNode subscriber = body.path("subscriber");
        JsonNode entitlement = subscriber.path("entitlements").path(entitlementId);
        if (!entitlement.isObject()) {
            return Optional.empty();
        }
        String product = text(entitlement, "product_identifier");
        JsonNode sub = findSubscription(subscriber.path("subscriptions"), product);
        Instant expires = instant(entitlement, "expires_date");
        Instant grace = instant(entitlement, "grace_period_expires_date");
        Instant purchase = instant(entitlement, "purchase_date");
        if (sub != null) {
            // 구독 쪽 값이 더 자세하다(entitlement 는 가장 늦게 끝나는 구매를 고른 요약). 없으면 entitlement 값을 쓴다.
            expires = firstNonNull(instant(sub, "expires_date"), expires);
            grace = firstNonNull(instant(sub, "grace_period_expires_date"), grace);
            purchase = firstNonNull(instant(sub, "purchase_date"), purchase);
        }
        return Optional.of(new StoreSubscription(
                sub == null ? null : text(sub, "store"),
                baseProduct(product),
                purchase,
                expires,
                grace,
                sub == null ? null : instant(sub, "unsubscribe_detected_at"),
                sub == null ? null : instant(sub, "billing_issues_detected_at"),
                sub == null ? null : instant(sub, "refunded_at"),
                sub != null && sub.path("is_sandbox").asBoolean(false),
                sub == null ? null : text(sub, "store_transaction_id")));
    }

    /** {@code subscriptions} 에서 상품의 구독을 찾는다. 키가 정확히 같거나, Google 처럼 {@code 구독ID:요금제ID} 의 앞부분이 같은 것. */
    private static JsonNode findSubscription(JsonNode subscriptions, String product) {
        if (product == null || !subscriptions.isObject()) {
            return null;
        }
        JsonNode exact = subscriptions.get(product);
        if (exact != null && exact.isObject()) {
            return exact;
        }
        String base = baseProduct(product);
        for (Iterator<Map.Entry<String, JsonNode>> it = subscriptions.fields(); it.hasNext();) {
            Map.Entry<String, JsonNode> entry = it.next();
            if (base.equals(baseProduct(entry.getKey())) && entry.getValue().isObject()) {
                return entry.getValue();
            }
        }
        return null;
    }

    static String baseProduct(String product) {
        if (product == null) {
            return null;
        }
        int colon = product.indexOf(':');
        return colon < 0 ? product : product.substring(0, colon);
    }

    private static String text(JsonNode node, String field) {
        JsonNode value = node.get(field);
        return value == null || value.isNull() ? null : value.asText();
    }

    private static Instant instant(JsonNode node, String field) {
        String value = text(node, field);
        if (value == null || value.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(value);
        } catch (DateTimeParseException notInstant) {
            try {
                return OffsetDateTime.parse(value).toInstant();
            } catch (DateTimeParseException ignored) {
                return null;
            }
        }
    }

    private static <T> T firstNonNull(T first, T second) {
        return first != null ? first : second;
    }
}
