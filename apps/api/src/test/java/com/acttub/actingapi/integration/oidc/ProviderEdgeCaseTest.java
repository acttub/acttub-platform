package com.acttub.actingapi.integration.oidc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.web.client.MockRestServiceServer;
import org.springframework.test.web.client.ResponseCreator;
import org.springframework.web.client.RestClient;

import static org.springframework.test.web.client.response.MockRestResponseCreators.withStatus;
import static org.springframework.test.web.client.response.MockRestResponseCreators.withSuccess;

/** 제공자가 문서와 다르게 답하거나 설정이 빠졌을 때 무엇으로 갈리는지 (CONTRACT §6-6·§6-7). */
class ProviderEdgeCaseTest {

    private static RestClient.Builder responding(ResponseCreator response) {
        RestClient.Builder builder = RestClient.builder();
        MockRestServiceServer.bindTo(builder).build().expect(request -> { }).andRespond(response);
        return builder;
    }

    private static JwtDecoder decoding(Map<String, Object> claims, List<String> audience) {
        return token -> {
            Jwt.Builder jwt = Jwt.withTokenValue(token).header("alg", "RS256");
            claims.forEach(jwt::claim);
            if (!audience.isEmpty()) {
                jwt.audience(audience);
            }
            return jwt.build();
        };
    }

    @Test
    void naverAnswerWithoutAnIdTokenOrUnreadableIsAnOutageAndAMissingRefreshTokenIsAllowed() {
        assertThatThrownBy(() -> new HttpNaverTokenClient("id", "secret",
                responding(withSuccess("<html>점검 중</html>", MediaType.TEXT_HTML))).exchange("c", " ", " ", " "))
                .isInstanceOf(ProviderUnavailable.class)
                .hasMessage("naver token endpoint answered without an id_token");

        NaverTokenClient.NaverGrant grant = new HttpNaverTokenClient("id", "secret",
                responding(withSuccess("{\"id_token\":\"a.b.c\",\"refresh_token\":7}", MediaType.APPLICATION_JSON)))
                .exchange("c", null, null, "s");

        assertThat(grant.idToken()).isEqualTo("a.b.c");
        assertThat(grant.refreshToken()).isNull();
    }

    @Test
    void naverRejectingTheClientIsAConfigurationError() {
        assertThatThrownBy(() -> new HttpNaverTokenClient("id", "secret", responding(withStatus(HttpStatus.BAD_REQUEST)
                .body("{\"error\":\"invalid_client\"}").contentType(MediaType.APPLICATION_JSON)))
                .exchange("c", "v", null, "s"))
                .isInstanceOf(ProviderConfigurationError.class);
        assertThatThrownBy(() -> new HttpNaverTokenClient("id", "secret", responding(withStatus(HttpStatus.UNAUTHORIZED)))
                .revoke("refresh"))
                .isInstanceOf(ProviderConfigurationError.class)
                .hasMessage("naver rejected the client credentials");
        assertThatThrownBy(() -> new HttpNaverTokenClient(null, null, RestClient.builder()).revoke("refresh"))
                .isInstanceOf(ProviderConfigurationError.class);
    }

    @Test
    void appleAnswerWithoutARefreshTokenIsAnOutageAndABrokenKeyOrGrantIsRejected() throws Exception {
        java.security.KeyPairGenerator generator = java.security.KeyPairGenerator.getInstance("EC");
        generator.initialize(new java.security.spec.ECGenParameterSpec("secp256r1"));
        String pem = Base64.getEncoder().encodeToString(generator.generateKeyPair().getPrivate().getEncoded());
        Clock clock = Clock.fixed(Instant.parse("2026-10-02T03:00:00Z"), java.time.ZoneOffset.UTC);

        assertThatThrownBy(() -> new HttpAppleTokenClient("TEAM", "KEY", pem, clock,
                responding(withSuccess("not json", MediaType.TEXT_PLAIN))).exchange("c", "com.acttub.app"))
                .isInstanceOf(ProviderUnavailable.class)
                .hasMessage("apple token response has no refresh_token");
        assertThatThrownBy(() -> new HttpAppleTokenClient("TEAM", "KEY", "bm90LWEta2V5", clock, RestClient.builder())
                .exchange("c", "com.acttub.app"))
                .isInstanceOf(ProviderConfigurationError.class)
                .hasMessage("APPLE_PRIVATE_KEY cannot sign a client secret");
        assertThatThrownBy(() -> new HttpAppleTokenClient(null, null, null, clock, RestClient.builder())
                .exchange("c", "com.acttub.app"))
                .isInstanceOf(ProviderConfigurationError.class)
                .hasMessage("APPLE_TEAM_ID, APPLE_KEY_ID or APPLE_PRIVATE_KEY not configured");
        assertThatThrownBy(() -> new HttpAppleTokenClient("TEAM", "KEY", pem, clock, RestClient.builder())
                .revoke("not a grant"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessage("not an apple grant");
    }

    @Test
    void identityNeedsASubjectAndReadsEmailVerificationFromBooleanOrText() {
        AppleProviderVerifier noSubject = new AppleProviderVerifier("com.acttub.app",
                decoding(Map.of("sub", 42), List.of("com.acttub.app")));
        AppleProviderVerifier textVerified = new AppleProviderVerifier("com.acttub.app",
                decoding(Map.of("sub", "apple-1", "email", "", "email_verified", "TRUE"), List.of()));

        assertThatThrownBy(() -> noSubject.verify("t"))
                .isInstanceOf(InvalidIdentityToken.class)
                .hasMessage("apple id_token is missing sub");
        assertThat(textVerified.verify("t")).isEqualTo(new ProviderIdentity("apple-1", null, true, null));
    }

    @Test
    void kakaoNeverTrustsEmailVerificationAndNeedsConfiguredAudiences() {
        KakaoProviderVerifier kakao = new KakaoProviderVerifier(" kakao-app , ",
                decoding(Map.of("sub", "k-1", "email", "a@b.c", "email_verified", true), List.of("kakao-app")));

        assertThat(kakao.verify("t")).isEqualTo(new ProviderIdentity("k-1", "a@b.c", false, "kakao-app"));
        assertThatThrownBy(() -> new KakaoProviderVerifier(null, token -> {
            throw new BadJwtException("bad");
        }).verify("t"))
                .isInstanceOf(ProviderConfigurationError.class)
                .hasMessage("KAKAO_OAUTH_CLIENT_ID not configured");
        assertThatThrownBy(() -> new KakaoProviderVerifier("kakao-app", token -> {
            throw new BadJwtException("bad signature");
        }).verify("t"))
                .isInstanceOf(InvalidIdentityToken.class)
                .hasMessage("invalid kakao id_token");
        assertThatThrownBy(() -> new KakaoProviderVerifier(" ").verify("t"))
                .isInstanceOf(ProviderConfigurationError.class);
        assertThatThrownBy(() -> new AppleProviderVerifier(" ").verify("t"))
                .isInstanceOf(ProviderConfigurationError.class)
                .hasMessage("APPLE_OAUTH_CLIENT_ID not configured");
    }

    @Test
    void naverNoticeWithAValidSignatureButAnUnreadableIdentifierIsRejected() throws Exception {
        NaverDisconnectNotice notice = new NaverDisconnectNotice("naver-id", "naver-secret");
        String tooShort = Base64.getUrlEncoder().withoutPadding().encodeToString(new byte[16]);
        String notBase64 = "@@@@";
        String key = "naver-secret";

        assertThatThrownBy(() -> notice.disconnectedUserId("naver-id", tooShort, "1",
                NaverDisconnectNotice.sign(NaverDisconnectNotice.key(key), "naver-id", tooShort, "1")))
                .isInstanceOf(InvalidProviderNotice.class);
        assertThatThrownBy(() -> notice.disconnectedUserId("naver-id", notBase64, "1",
                NaverDisconnectNotice.sign(NaverDisconnectNotice.key(key), "naver-id", notBase64, "1")))
                .isInstanceOf(InvalidProviderNotice.class);
        assertThatThrownBy(() -> notice.disconnectedUserId("naver-id", tooShort, null, "sig"))
                .isInstanceOf(InvalidProviderNotice.class);
        assertThatThrownBy(() -> new NaverDisconnectNotice(null, null).disconnectedUserId("a", "b", "c", "d"))
                .isInstanceOf(ProviderConfigurationError.class);
    }
}
