package com.acttub.actingapi.integration.oidc;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtValidationException;

/**
 * 카카오·네이버 ID 토큰의 검증 규칙. 발급자와 공개키 주소는 각 제공자의 OIDC 메타데이터의 값이다.
 * 서명 검증 자체는 실물 공개키가 필요해 여기서 보지 않는다 — 발급자·청중·만료의 판정과, 두 제공자 모두
 * ID 토큰만으로는 이메일을 검증된 것으로 보지 않는다는 것을 본다.
 */
class KakaoNaverVerifierTest {

    @Test
    @DisplayName("account.login: 카카오 ID 토큰은 발급자와 우리 앱 키(aud)와 만료를 본다")
    void kakaoValidatorChecksIssuerAudienceAndExpiry() {
        Jwt valid = jwt(KakaoProviderVerifier.ISSUER, "native-app-key", Instant.now().plusSeconds(600));

        assertThat(KakaoProviderVerifier.validator("rest-key, native-app-key").validate(valid).hasErrors()).isFalse();
        assertThat(KakaoProviderVerifier.validator("another-app").validate(valid).hasErrors()).isTrue();
        assertThat(KakaoProviderVerifier.validator("native-app-key")
                .validate(jwt("https://evil.test", "native-app-key", Instant.now().plusSeconds(600))).hasErrors())
                .isTrue();
        assertThat(KakaoProviderVerifier.validator("native-app-key")
                .validate(jwt(KakaoProviderVerifier.ISSUER, "native-app-key", Instant.now().minusSeconds(120)))
                .hasErrors()).isTrue();
    }

    @Test
    @DisplayName("account.login: 네이버 ID 토큰은 발급자와 우리 Client ID(aud)와 만료를 본다")
    void naverValidatorChecksIssuerAudienceAndExpiry() {
        Jwt valid = jwt(NaverProviderVerifier.ISSUER, "naver-client-id", Instant.now().plusSeconds(600));

        assertThat(NaverProviderVerifier.validator("naver-client-id").validate(valid).hasErrors()).isFalse();
        assertThat(NaverProviderVerifier.validator("another-app").validate(valid).hasErrors()).isTrue();
        assertThat(NaverProviderVerifier.validator("naver-client-id")
                .validate(jwt("https://evil.test", "naver-client-id", Instant.now().plusSeconds(600))).hasErrors())
                .isTrue();
        assertThat(NaverProviderVerifier.validator("naver-client-id")
                .validate(jwt(NaverProviderVerifier.ISSUER, "naver-client-id", Instant.now().minusSeconds(120)))
                .hasErrors()).isTrue();
    }

    @Test
    @DisplayName("account.login: 카카오·네이버의 ID 토큰은 이메일을 주더라도 검증된 것으로 알리지 않는다")
    void neitherProviderClaimsAVerifiedEmailFromTheIdToken() {
        Jwt kakaoToken = jwt(KakaoProviderVerifier.ISSUER, "app-key", Instant.now().plusSeconds(600));
        Jwt naverToken = jwt(NaverProviderVerifier.ISSUER, "client-id", Instant.now().plusSeconds(600));

        assertThat(new KakaoProviderVerifier("app-key", token -> kakaoToken).verify("t"))
                .isEqualTo(new ProviderIdentity("uid-1", "actor@example.test", false, "app-key"));
        assertThat(new NaverProviderVerifier("client-id", token -> naverToken).verify("t"))
                .isEqualTo(new ProviderIdentity("uid-1", "actor@example.test", false, "client-id"));
    }

    @Test
    @DisplayName("account.login: 설정이 없으면 503 으로 옮길 설정 오류이고, 검증 실패는 401 로 옮길 잘못된 토큰이다")
    void missingConfigurationAndDecoderFailuresAreToldApart() {
        assertThatThrownBy(() -> new KakaoProviderVerifier("", null).verify("t"))
                .isInstanceOf(ProviderConfigurationError.class);
        assertThatThrownBy(() -> new NaverProviderVerifier(" ", null).verify("t"))
                .isInstanceOf(ProviderConfigurationError.class);
        assertThatThrownBy(() -> new KakaoProviderVerifier("app-key", token -> {
                    throw new JwtValidationException("invalid", List.of(new OAuth2Error("invalid_token")));
                }).verify("forged"))
                .isInstanceOf(InvalidIdentityToken.class);
        assertThatThrownBy(() -> new NaverProviderVerifier("client-id", token -> {
                    throw new JwtValidationException("invalid", List.of(new OAuth2Error("invalid_token")));
                }).verify("forged"))
                .isInstanceOf(InvalidIdentityToken.class);
    }

    private static Jwt jwt(String issuer, String audience, Instant expiresAt) {
        return Jwt.withTokenValue("t")
                .header("alg", "RS256")
                .claims(claims -> claims.putAll(Map.of(
                        "iss", issuer,
                        "aud", List.of(audience),
                        "sub", "uid-1",
                        "email", "actor@example.test",
                        "email_verified", true)))
                .issuedAt(expiresAt.minusSeconds(900))
                .expiresAt(expiresAt)
                .build();
    }
}
