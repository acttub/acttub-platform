package com.acttub.actingapi.feature.billing.adapter.store;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import com.acttub.actingapi.feature.billing.app.StoreGateways.GoogleSubscription;
import com.acttub.actingapi.feature.billing.app.StoreGateways.StoreException;
import com.acttub.actingapi.support.MutableClock;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** 진짜 Google 대신 로컬 HTTP 서버를 세워 토큰 교환·조회·승인의 요청 모양과 응답 해석을 본다. */
class GoogleStoreGatewayImplTest {
    HttpServer server;
    String base;
    final List<String> calls = new CopyOnWriteArrayList<>();
    volatile int getStatus = 200;
    volatile String getBody;
    volatile int ackStatus = 204;
    GoogleStoreGatewayImpl gateway;

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        base = "http://127.0.0.1:" + server.getAddress().getPort();
        server.createContext("/token", exchange -> {
            String form = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            calls.add("token:" + form.contains("grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer"));
            byte[] out = "{\"access_token\":\"at-1\",\"expires_in\":3600}".getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(200, out.length);
            exchange.getResponseBody().write(out);
            exchange.close();
        });
        server.createContext("/androidpublisher", exchange -> {
            calls.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getRawPath() + " auth="
                    + exchange.getRequestHeaders().getFirst("Authorization"));
            boolean ack = exchange.getRequestURI().getRawPath().endsWith(":acknowledge");
            int status = ack ? ackStatus : getStatus;
            byte[] out = (ack ? "" : getBody == null ? "{}" : getBody).getBytes(StandardCharsets.UTF_8);
            exchange.sendResponseHeaders(status, out.length == 0 ? -1 : out.length);
            if (out.length > 0) {
                exchange.getResponseBody().write(out);
            }
            exchange.close();
        });
        server.start();
        KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        KeyPair pair = generator.generateKeyPair();
        String pem = "-----BEGIN PRIVATE KEY-----\n" + Base64.getMimeEncoder(64, "\n".getBytes()).encodeToString(pair.getPrivate().getEncoded())
                + "\n-----END PRIVATE KEY-----\n";
        String json = "{\"client_email\":\"play@acttub.iam.gserviceaccount.com\",\"private_key\":" + quote(pem)
                + ",\"token_uri\":\"" + base + "/token\"}";
        gateway = new GoogleStoreGatewayImpl("com.acttub.app", json, base, new MutableClock(Instant.parse("2026-11-03T01:00:00Z")));
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    static String quote(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\n", "\\n").replace("\"", "\\\"") + "\"";
    }

    @Test
    void parsesSubscriptionAndSendsServiceAccountToken() {
        getBody = """
                {"subscriptionState":"SUBSCRIPTION_STATE_ACTIVE","startTime":"2026-11-03T00:00:00Z",
                 "acknowledgementState":"ACKNOWLEDGEMENT_STATE_PENDING",
                 "externalAccountIdentifiers":{"obfuscatedExternalAccountId":"user-1"},
                 "lineItems":[{"productId":"acttub_pro_monthly","expiryTime":"2026-12-03T00:00:00Z",
                               "autoRenewingPlan":{"autoRenewEnabled":true}}]}
                """;
        GoogleSubscription sub = gateway.get("tok/en+1");
        assertThat(sub.state()).isEqualTo("SUBSCRIPTION_STATE_ACTIVE");
        assertThat(sub.productId()).isEqualTo("acttub_pro_monthly");
        assertThat(sub.expiryTime()).isEqualTo(Instant.parse("2026-12-03T00:00:00Z"));
        assertThat(sub.autoRenewing()).isTrue();
        assertThat(sub.acknowledged()).isFalse();
        assertThat(sub.obfuscatedAccountId()).isEqualTo("user-1");
        assertThat(calls).contains("token:true");
        assertThat(calls.stream().anyMatch(c -> c.startsWith("GET /androidpublisher/v3/applications/com.acttub.app/purchases/subscriptionsv2/tokens/tok%2Fen%2B1")
                && c.endsWith("auth=Bearer at-1"))).isTrue();
        gateway.get("tok");
        assertThat(calls.stream().filter(c -> c.startsWith("token:")).count()).isEqualTo(1);
    }

    @Test
    void acknowledgesThroughTheSubscriptionsEndpoint() {
        gateway.acknowledge("acttub_pro_monthly", "tok");
        assertThat(calls.stream().anyMatch(c -> c.startsWith("POST /androidpublisher/v3/applications/com.acttub.app/purchases/subscriptions/acttub_pro_monthly/tokens/tok:acknowledge"))).isTrue();
        ackStatus = 500;
        assertThatThrownBy(() -> gateway.acknowledge("acttub_pro_monthly", "tok")).isInstanceOfSatisfying(StoreException.class,
                e -> assertThat(e.kind()).isEqualTo(StoreException.Kind.UPSTREAM));
    }

    @Test
    void unknownTokenIsInvalidAndServerErrorIsRetryable() {
        getStatus = 404;
        assertThatThrownBy(() -> gateway.get("bad")).isInstanceOfSatisfying(StoreException.class,
                e -> assertThat(e.kind()).isEqualTo(StoreException.Kind.INVALID));
        getStatus = 503;
        assertThatThrownBy(() -> gateway.get("bad")).isInstanceOfSatisfying(StoreException.class,
                e -> assertThat(e.kind()).isEqualTo(StoreException.Kind.UPSTREAM));
    }

    @Test
    void brokenServiceAccountKeyIsRejectedWithoutEchoingIt() {
        assertThatThrownBy(() -> new GoogleStoreGatewayImpl("com.acttub.app", "{\"client_email\":\"x\",\"private_key\":\"SECRET-ABC\"}",
                new MutableClock(Instant.now()))).isInstanceOf(IllegalArgumentException.class)
                .hasMessageNotContaining("SECRET-ABC");
    }
}
