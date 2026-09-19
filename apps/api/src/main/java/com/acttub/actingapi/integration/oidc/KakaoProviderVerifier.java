package com.acttub.actingapi.integration.oidc;

import java.util.Arrays;
import java.util.List;

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
 * 카카오 OIDC ID 토큰 검증. 발급자·공개키 주소·서명 알고리즘은 카카오 공식 문서의 값이다
 * (developers.kakao.com › 카카오 로그인 › REST API › OIDC, 메타데이터
 * {@code https://kauth.kakao.com/.well-known/openid-configuration}).
 *
 * <p>{@code aud} 는 앱이 로그인을 시작할 때 쓴 앱 키다. iOS·안드로이드 앱은 네이티브 앱 키를 쓰므로
 * {@code KAKAO_OAUTH_CLIENT_ID} 에 그 키를 둔다(쉼표로 여럿).
 *
 * <p>⚠ 카카오 ID 토큰에는 {@code email_verified} 가 없다. 그래서 여기서 나온 신원의 이메일은 언제나
 * "검증 안 됨"이고, 검증 여부는 처음 온 신원에 한해 {@link KakaoUserClient 사용자 정보 API}로 확인한다.
 */
@Component
public class KakaoProviderVerifier implements ProviderVerifier {
    public static final String ISSUER = "https://kauth.kakao.com";
    public static final String JWKS = "https://kauth.kakao.com/.well-known/jwks.json";

    private final List<String> audiences;
    private final JwtDecoder decoder;

    @Autowired
    public KakaoProviderVerifier(@Value("${KAKAO_OAUTH_CLIENT_ID:}") String ids) {
        this(ids, ids == null || ids.isBlank() ? null : decoder(ids));
    }

    public KakaoProviderVerifier(String ids, JwtDecoder decoder) {
        this.audiences = audiences(ids);
        this.decoder = decoder;
    }

    @Override
    public String provider() {
        return "kakao";
    }

    @Override
    public ProviderIdentity verify(String token) {
        if (audiences.isEmpty() || decoder == null) {
            throw new ProviderConfigurationError("KAKAO_OAUTH_CLIENT_ID not configured");
        }
        try {
            ProviderIdentity identity = OidcClaims.identity(decoder.decode(token), "kakao");
            return new ProviderIdentity(identity.providerUid(), identity.email(), false, identity.audience());
        } catch (JwtException e) {
            throw new InvalidIdentityToken("invalid kakao id_token", e);
        }
    }

    static JwtDecoder decoder(String ids) {
        NimbusJwtDecoder value = NimbusJwtDecoder.withJwkSetUri(JWKS)
                .jwsAlgorithm(SignatureAlgorithm.RS256)
                .build();
        value.setJwtValidator(validator(ids));
        return value;
    }

    static OAuth2TokenValidator<Jwt> validator(String ids) {
        List<String> audiences = audiences(ids);
        return new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefaultWithIssuer(ISSUER),
                jwt -> jwt.getAudience().stream().anyMatch(audiences::contains)
                        ? OAuth2TokenValidatorResult.success()
                        : OAuth2TokenValidatorResult.failure(
                                new OAuth2Error("invalid_token", "invalid audience", null)));
    }

    private static List<String> audiences(String ids) {
        return ids == null
                ? List.of()
                : Arrays.stream(ids.split(",")).map(String::strip).filter(s -> !s.isEmpty()).toList();
    }
}
