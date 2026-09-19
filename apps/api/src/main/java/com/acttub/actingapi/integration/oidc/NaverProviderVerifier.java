package com.acttub.actingapi.integration.oidc;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.SignatureAlgorithm;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtException;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.stereotype.Component;

/**
 * 네이버 OIDC ID 토큰 검증. 다른 제공자와 달리 이 토큰은 앱이 아니라 <b>서버가</b>
 * {@link NaverTokenClient 코드 교환}으로 받은 것이다(SOMA-528 결정 I-5).
 *
 * <p>발급자·공개키 주소는 네이버 로그인 개발가이드 §3.5(OIDC)와 그 메타데이터
 * ({@code https://nid.naver.com/.well-known/openid-configuration})의 값이다. {@code aud} 는 우리
 * Client ID 다.
 *
 * <p>네이버는 이메일 검증 표시를 주지 않는다. 여기서 나온 신원의 이메일은 "검증 안 됨"이고, 검증으로
 * 볼지는 부르는 쪽이 주소로 판단한다(@naver.com 이면 그 계정의 메일함이다).
 */
@Component
public class NaverProviderVerifier implements ProviderVerifier {
    public static final String ISSUER = "https://nid.naver.com";
    public static final String JWKS = "https://nid.naver.com/oauth2/jwks";

    private final String audience;
    private final JwtDecoder decoder;

    @Autowired
    public NaverProviderVerifier(@Value("${NAVER_OAUTH_CLIENT_ID:}") String audience) {
        this(audience, audience == null || audience.isBlank() ? null : decoder(audience.strip()));
    }

    public NaverProviderVerifier(String audience, JwtDecoder decoder) {
        this.audience = audience == null ? "" : audience.strip();
        this.decoder = decoder;
    }

    @Override
    public String provider() {
        return "naver";
    }

    @Override
    public ProviderIdentity verify(String token) {
        if (audience.isEmpty() || decoder == null) {
            throw new ProviderConfigurationError("NAVER_OAUTH_CLIENT_ID not configured");
        }
        try {
            ProviderIdentity identity = OidcClaims.identity(decoder.decode(token), "naver");
            return new ProviderIdentity(identity.providerUid(), identity.email(), false, identity.audience());
        } catch (JwtException e) {
            throw new InvalidIdentityToken("invalid naver id_token", e);
        }
    }

    static JwtDecoder decoder(String audience) {
        NimbusJwtDecoder value = NimbusJwtDecoder.withJwkSetUri(JWKS)
                .jwsAlgorithm(SignatureAlgorithm.RS256)
                .build();
        value.setJwtValidator(validator(audience));
        return value;
    }

    static OAuth2TokenValidator<Jwt> validator(String audience) {
        return new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefaultWithIssuer(ISSUER),
                jwt -> jwt.getAudience().contains(audience)
                        ? OAuth2TokenValidatorResult.success()
                        : OAuth2TokenValidatorResult.failure(
                                new OAuth2Error("invalid_token", "invalid audience", null)));
    }
}
