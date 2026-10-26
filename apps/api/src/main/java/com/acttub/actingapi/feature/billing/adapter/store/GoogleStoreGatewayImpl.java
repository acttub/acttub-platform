package com.acttub.actingapi.feature.billing.adapter.store;

import com.acttub.actingapi.feature.billing.app.BillingRules;

import java.io.IOException;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.interfaces.RSAPrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.app.StoreGateways.GoogleStoreGateway;
import com.acttub.actingapi.feature.billing.app.StoreGateways.GoogleSubscription;
import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Google Play Developer API(androidpublisher v3)를 서비스 계정으로 부른다(SOMA-818 2단계). 서비스 계정 JSON 의 개인키로
 * OAuth2 JWT bearer 토큰을 받아(1시간, 메모리 캐시) {@code purchases.subscriptionsv2.get} 으로 조회하고
 * {@code purchases.subscriptions.acknowledge} 로 승인한다. 개인키·액세스 토큰·구매 토큰은 로그와 예외에 싣지 않는다.
 */
public class GoogleStoreGatewayImpl implements GoogleStoreGateway {
    private static final Logger LOG = LoggerFactory.getLogger(GoogleStoreGatewayImpl.class);
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String SCOPE = "https://www.googleapis.com/auth/androidpublisher";
    static final String DEFAULT_API = "https://androidpublisher.googleapis.com";

    private final String packageName;
    private final String clientEmail;
    private final RSAPrivateKey privateKey;
    private final String tokenUri;
    private final String apiBase;
    private final HttpClient http;
    private final Clock clock;
    private String accessToken;
    private Instant accessTokenExpiry = Instant.EPOCH;

    /** @param serviceAccountJson 서비스 계정 키 JSON 원문(또는 그것의 base64) */
    public GoogleStoreGatewayImpl(String packageName, String serviceAccountJson, Clock clock) {
        this(packageName, serviceAccountJson, DEFAULT_API, clock);
    }

    GoogleStoreGatewayImpl(String packageName, String serviceAccountJson, String apiBase, Clock clock) {
        this.packageName = packageName;
        this.apiBase = apiBase;
        this.clock = clock;
        try {
            String raw = serviceAccountJson.strip();
            if (!raw.startsWith("{")) {
                raw = new String(Base64.getDecoder().decode(raw), StandardCharsets.UTF_8);
            }
            JsonNode account = JSON.readTree(raw);
            this.clientEmail = account.path("client_email").asText();
            this.tokenUri = account.path("token_uri").asText("https://oauth2.googleapis.com/token");
            String pem = account.path("private_key").asText()
                    .replace("-----BEGIN PRIVATE KEY-----", "").replace("-----END PRIVATE KEY-----", "").replaceAll("\\s", "");
            this.privateKey = (RSAPrivateKey) KeyFactory.getInstance("RSA")
                    .generatePrivate(new PKCS8EncodedKeySpec(Base64.getDecoder().decode(pem)));
            if (clientEmail.isBlank()) {
                throw new IllegalArgumentException("client_email missing");
            }
        } catch (Exception invalid) {
            // 원문을 메시지에 싣지 않는다.
            throw new IllegalArgumentException("BILLING_GOOGLE_SERVICE_ACCOUNT_JSON is not a valid service account key");
        }
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    }

    @Override
    public boolean configured() {
        return true;
    }

    @Override
    public String packageName() {
        return packageName;
    }

    @Override
    public GoogleSubscription get(String purchaseToken) {
        String url = apiBase + "/androidpublisher/v3/applications/" + enc(packageName)
                + "/purchases/subscriptionsv2/tokens/" + enc(purchaseToken);
        HttpResponse<String> response = send(HttpRequest.newBuilder(URI.create(url)).GET());
        int status = response.statusCode();
        if (status == 400 || status == 404 || status == 410) {
            // 없는 토큰·만료로 조회가 안 되는 토큰 — 가짜 영수증이다.
            throw new StoreException(StoreException.Kind.INVALID, "invalid_store_receipt");
        }
        if (status != 200) {
            LOG.warn("google play subscriptionsv2.get failed status={}", status);
            throw new StoreException(StoreException.Kind.UPSTREAM, "store_upstream_error");
        }
        try {
            JsonNode body = JSON.readTree(response.body());
            JsonNode line = body.path("lineItems").path(0);
            JsonNode lines = body.path("lineItems");
            for (JsonNode candidate : lines) {
                if (BillingRules.storeProduct(candidate.path("productId").asText())) {
                    line = candidate;
                    break;
                }
            }
            return new GoogleSubscription(
                    body.path("subscriptionState").asText(""),
                    line.path("productId").asText(""),
                    time(body.path("startTime")),
                    time(line.path("expiryTime")),
                    line.path("autoRenewingPlan").path("autoRenewEnabled").asBoolean(false),
                    body.path("externalAccountIdentifiers").path("obfuscatedExternalAccountId").asText(null),
                    body.path("linkedPurchaseToken").asText(null),
                    "ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED".equals(body.path("acknowledgementState").asText()));
        } catch (IOException malformed) {
            throw new StoreException(StoreException.Kind.UPSTREAM, "store_upstream_error");
        }
    }

    @Override
    public void acknowledge(String productId, String purchaseToken) {
        String url = apiBase + "/androidpublisher/v3/applications/" + enc(packageName) + "/purchases/subscriptions/"
                + enc(productId) + "/tokens/" + enc(purchaseToken) + ":acknowledge";
        HttpResponse<String> response = send(HttpRequest.newBuilder(URI.create(url))
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofString("{}")));
        // 이미 승인된 토큰은 400 으로 오기도 한다 — 승인 상태는 get 이 알려 주므로 여기서는 200·204 만 성공으로 본다.
        if (response.statusCode() != 200 && response.statusCode() != 204) {
            LOG.warn("google play acknowledge failed status={}", response.statusCode());
            throw new StoreException(StoreException.Kind.UPSTREAM, "store_upstream_error");
        }
    }

    private HttpResponse<String> send(HttpRequest.Builder request) {
        try {
            return http.send(request.timeout(Duration.ofSeconds(10))
                    .header("Authorization", "Bearer " + accessToken()).build(), HttpResponse.BodyHandlers.ofString());
        } catch (IOException | InterruptedException failure) {
            if (failure instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new StoreException(StoreException.Kind.UPSTREAM, "store_upstream_error");
        }
    }

    private synchronized String accessToken() {
        Instant now = clock.instant();
        if (accessToken != null && now.isBefore(accessTokenExpiry.minusSeconds(60))) {
            return accessToken;
        }
        try {
            SignedJWT assertion = new SignedJWT(new JWSHeader.Builder(JWSAlgorithm.RS256).type(JOSEObjectType.JWT).build(),
                    new JWTClaimsSet.Builder().issuer(clientEmail).claim("scope", SCOPE).audience(tokenUri)
                            .issueTime(Date.from(now)).expirationTime(Date.from(now.plusSeconds(3000)))
                            .jwtID(UUID.randomUUID().toString()).build());
            assertion.sign(new RSASSASigner(privateKey));
            String form = "grant_type=" + enc("urn:ietf:params:oauth:grant-type:jwt-bearer") + "&assertion=" + enc(assertion.serialize());
            HttpResponse<String> response = http.send(HttpRequest.newBuilder(URI.create(tokenUri))
                    .timeout(Duration.ofSeconds(10)).header("Content-Type", "application/x-www-form-urlencoded")
                    .POST(HttpRequest.BodyPublishers.ofString(form)).build(), HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                LOG.error("google oauth token request failed status={}", response.statusCode());
                throw new StoreException(StoreException.Kind.UPSTREAM, "store_upstream_error");
            }
            JsonNode body = JSON.readTree(response.body());
            accessToken = body.path("access_token").asText();
            accessTokenExpiry = now.plusSeconds(body.path("expires_in").asLong(3000));
            return accessToken;
        } catch (StoreException failure) {
            throw failure;
        } catch (Exception failure) {
            if (failure instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            throw new StoreException(StoreException.Kind.UPSTREAM, "store_upstream_error");
        }
    }

    private static Instant time(JsonNode node) {
        return node.isMissingNode() || node.isNull() || node.asText().isBlank() ? null : Instant.parse(node.asText());
    }

    private static String enc(String value) {
        return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");
    }
}
