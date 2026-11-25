package com.acttub.actingapi.feature.appversion.adapter.store;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.feature.appversion.domain.AppVersion;
import com.nimbusds.jose.crypto.RSASSAVerifier;
import com.nimbusds.jwt.SignedJWT;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.interfaces.RSAPublicKey;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Play 개발자 API 를 흉내 낸 서버로 본다 — 서비스 계정 키로 서명한 토큰 요청, 편집 열기 → 운영 트랙 읽기 → 편집 지우기.
 * 편집은 저장(commit)하지 않는다.
 */
class PlayProductionTrackTest {

    private static final Instant NOW = Instant.parse("2026-12-01T00:00:00Z");
    private static final KeyPair KEYS = keys();

    private HttpServer server;
    private final List<String> calls = new CopyOnWriteArrayList<>();
    private volatile String track = "{}";
    private volatile int trackStatus = 200;

    private static KeyPair keys() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("RSA");
            generator.initialize(2048);
            return generator.generateKeyPair();
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }

    @BeforeEach
    void start() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/token", exchange -> {
            String form = new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
            String assertion = URLDecoder.decode(form.replaceAll(".*assertion=([^&]*).*", "$1"), StandardCharsets.UTF_8);
            calls.add("token " + verified(assertion));
            reply(exchange, 200, "{\"access_token\":\"t-1\",\"expires_in\":3599,\"token_type\":\"Bearer\"}");
        });
        server.createContext("/apps/", exchange -> {
            String auth = exchange.getRequestHeaders().getFirst("Authorization");
            calls.add(exchange.getRequestMethod() + " " + exchange.getRequestURI().getPath() + " " + auth);
            String path = exchange.getRequestURI().getPath();
            if ("POST".equals(exchange.getRequestMethod()) && path.endsWith("/edits")) {
                reply(exchange, 200, "{\"id\":\"e-1\",\"expiryTimeSeconds\":\"1764550000\"}");
            } else if (path.endsWith("/tracks/production")) {
                reply(exchange, trackStatus, track);
            } else {
                reply(exchange, 204, "");
            }
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private static void reply(HttpExchange exchange, int status, String body) throws java.io.IOException {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().add("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length == 0 ? -1 : bytes.length);
        if (bytes.length > 0) {
            exchange.getResponseBody().write(bytes);
        }
        exchange.close();
    }

    private static String verified(String assertion) {
        try {
            SignedJWT jwt = SignedJWT.parse(assertion);
            boolean signed = jwt.verify(new RSASSAVerifier((RSAPublicKey) KEYS.getPublic()));
            return signed + " " + jwt.getJWTClaimsSet().getIssuer() + " " + jwt.getJWTClaimsSet().getStringClaim("scope");
        } catch (Exception failure) {
            return "invalid";
        }
    }

    private String base() {
        return "http://127.0.0.1:" + server.getAddress().getPort();
    }

    private String key() {
        String pem = "-----BEGIN PRIVATE KEY-----\n"
                + Base64.getMimeEncoder(64, "\n".getBytes(StandardCharsets.UTF_8)).encodeToString(KEYS.getPrivate().getEncoded())
                + "\n-----END PRIVATE KEY-----\n";
        return "{\"type\":\"service_account\",\"client_email\":\"reader@acttub.iam.gserviceaccount.com\","
                + "\"private_key_id\":\"k-1\",\"private_key\":\"" + pem.replace("\n", "\\n") + "\","
                + "\"token_uri\":\"" + base() + "/token\"}";
    }

    private PlayProductionTrack play(String key) {
        return new PlayProductionTrack(key, "com.acttub.app", base() + "/apps/",
                Clock.fixed(NOW, ZoneOffset.UTC), AppStoreLookup.builder());
    }

    @Test
    void 다_나간_출시_중_가장_높은_판을_읽고_편집은_저장하지_않고_지운다() {
        track = """
                {"track":"production","releases":[
                  {"name":"29 (1.2.0)","versionCodes":["29"],"status":"inProgress","userFraction":0.2},
                  {"name":"1.1.3","versionCodes":["28"],"status":"completed"}]}
                """;

        assertThat(play(key()).live()).contains(new AppVersion(1, 1, 3));
        assertThat(calls).containsExactly(
                "token true reader@acttub.iam.gserviceaccount.com " + PlayProductionTrack.SCOPE,
                "POST /apps/com.acttub.app/edits Bearer t-1",
                "GET /apps/com.acttub.app/edits/e-1/tracks/production Bearer t-1",
                "DELETE /apps/com.acttub.app/edits/e-1 Bearer t-1");
    }

    @Test
    void 키는_base64_로_넣어도_되고_토큰은_만료_전까지_다시_받지_않는다() {
        track = "{\"releases\":[{\"name\":\"30 (1.2.0)\",\"status\":\"completed\"}]}";
        PlayProductionTrack play = play(Base64.getEncoder().encodeToString(key().getBytes(StandardCharsets.UTF_8)));

        assertThat(play.live()).contains(new AppVersion(1, 2, 0));
        assertThat(play.live()).contains(new AppVersion(1, 2, 0));
        assertThat(calls.stream().filter(call -> call.startsWith("token"))).hasSize(1);
    }

    @Test
    void 단계적_출시_중이거나_이름에_판이_없으면_모른다() {
        track = "{\"releases\":[{\"name\":\"1.2.0\",\"status\":\"inProgress\",\"userFraction\":0.5},"
                + "{\"name\":\"1.1.9\",\"status\":\"halted\"},{\"name\":\"크래시 수정\",\"status\":\"completed\"}]}";

        assertThat(play(key()).live()).isEmpty();
    }

    @Test
    void 트랙을_못_읽어도_편집은_지우고_모른다고_답한다() {
        trackStatus = 403;
        track = "{\"error\":{\"code\":403}}";

        assertThat(play(key()).live()).isEmpty();
        assertThat(calls).anyMatch(call -> call.startsWith("DELETE /apps/com.acttub.app/edits/e-1"));
    }

    @Test
    void 키가_없거나_못_읽으면_Play_를_부르지_않는다() {
        assertThat(play("").live()).isEmpty();
        assertThat(play("not-json").live()).isEmpty();
        assertThat(play("{\"client_email\":\"x@y\",\"private_key\":\"broken\"}").live()).isEmpty();
        assertThat(play("").configured()).isFalse();
        assertThat(calls).isEmpty();
    }
}
