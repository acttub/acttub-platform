package com.acttub.actingapi.feature.auth.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.UUID;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/** 비밀키로 제대로 서명했어도 모양이 어긋난 토큰은 받지 않는다 — 어느 자리가 어긋났는지 사유가 갈린다. */
class JwtServiceForgeryTest {
    private static final String SECRET = "forgery-test-secret";
    private static final Instant NOW = Instant.parse("2026-10-20T00:00:00Z");
    private static final String USER = "00000000-0000-0000-0000-000000000001";
    private static final String HEADER = "{\"alg\":\"HS256\",\"typ\":\"JWT\"}";

    private final JwtService jwt = new JwtService(SECRET, Clock.fixed(NOW, ZoneOffset.UTC), new ObjectMapper());

    private static String b64(String json) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(json.getBytes(StandardCharsets.UTF_8));
    }

    private static String signed(String header, String payload) throws Exception {
        String input = b64(header) + "." + b64(payload);
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return input + "." + Base64.getUrlEncoder().withoutPadding()
                .encodeToString(mac.doFinal(input.getBytes(StandardCharsets.US_ASCII)));
    }

    private static String payload(String iss, String aud, String type, String iat, String exp) {
        return "{\"iss\":\"" + iss + "\",\"aud\":\"" + aud + "\",\"sub\":\"" + USER + "\",\"jti\":\"" + UUID.randomUUID()
                + "\",\"token_type\":\"" + type + "\",\"iat\":" + iat + ",\"exp\":" + exp + "}";
    }

    private void assertRejected(String token, String reason) {
        assertThatThrownBy(() -> jwt.decode(token, "access", NOW))
                .isInstanceOf(JwtService.TokenValidationException.class)
                .hasMessage(reason);
    }

    @Test
    void correctlySignedTokenIsAcceptedAsTheBaseline() throws Exception {
        String token = signed(HEADER, payload("acting-api", "acting-app", "access",
                String.valueOf(NOW.getEpochSecond() - 1), String.valueOf(NOW.getEpochSecond() + 60)));

        assertThat(jwt.decode(token, "access", NOW).userId()).isEqualTo(UUID.fromString(USER));
        assertThat(jwt.verifyAccessToken(token)).isEqualTo(UUID.fromString(USER));
    }

    @Test
    void eachMismatchHasItsOwnReason() throws Exception {
        String iat = String.valueOf(NOW.getEpochSecond() - 1);
        String exp = String.valueOf(NOW.getEpochSecond() + 60);

        assertRejected(signed("{\"alg\":\"HS256\",\"typ\":\"JWT\",\"kid\":\"x\"}",
                payload("acting-api", "acting-app", "access", iat, exp)), "unsupported token header");
        assertRejected(signed(HEADER, "{\"sub\":\"" + USER + "\"}"), "missing token claims");
        assertRejected(signed(HEADER, payload("someone-else", "acting-app", "access", iat, exp)),
                "invalid token issuer or audience");
        assertRejected(signed(HEADER, payload("acting-api", "other-app", "access", iat, exp)),
                "invalid token issuer or audience");
        assertRejected(signed(HEADER, payload("acting-api", "acting-app", "refresh", iat, exp)), "wrong token type");
        assertRejected(signed(HEADER, payload("acting-api", "acting-app", "access", "\"" + iat + "\"", exp)),
                "invalid token timestamps");
        assertRejected(signed(HEADER, payload("acting-api", "acting-app", "access", iat, "1.5e9")),
                "invalid token timestamps");
        assertRejected("a.b", "invalid token structure");
        assertThat(jwt.verifyAccessToken("a.b.c")).isNull();
    }
}
