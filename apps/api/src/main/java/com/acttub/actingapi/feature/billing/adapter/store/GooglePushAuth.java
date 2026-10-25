package com.acttub.actingapi.feature.billing.adapter.store;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.List;
import java.util.Set;

import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.proc.DefaultJOSEObjectTypeVerifier;
import com.nimbusds.jose.proc.JWSVerificationKeySelector;
import com.nimbusds.jose.proc.SecurityContext;
import com.nimbusds.jose.jwk.source.JWKSource;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.proc.DefaultJWTClaimsVerifier;
import com.nimbusds.jwt.proc.DefaultJWTProcessor;

/**
 * Google RTDN(Pub/Sub 푸시) 요청이 진짜인지 확인한다(SOMA-818 2단계). 방식은 설정으로 고른다.
 *
 * <ul>
 *   <li>{@code token} — 푸시 주소의 {@code ?token=} 이 비밀 토큰과 같다(상수 시간 비교).</li>
 *   <li>{@code oidc} — {@code Authorization: Bearer} 의 Google 서명 OIDC 토큰을 검증한다: 서명(Google 공개키), 발급자,
 *       audience, 서비스 계정 이메일(email·email_verified), 만료.</li>
 *   <li>그 밖(기본 빈 값) — 모두 거부한다.</li>
 * </ul>
 */
public class GooglePushAuth {
    private final String mode;
    private final String secretToken;
    private final String audience;
    private final String serviceAccountEmail;
    private final JWKSource<SecurityContext> keys;

    public GooglePushAuth(String mode, String secretToken, String audience, String serviceAccountEmail,
            JWKSource<SecurityContext> googleKeys) {
        this.mode = mode == null ? "" : mode.strip();
        this.secretToken = secretToken == null ? "" : secretToken;
        this.audience = audience == null ? "" : audience.strip();
        this.serviceAccountEmail = serviceAccountEmail == null ? "" : serviceAccountEmail.strip();
        this.keys = googleKeys;
    }

    public boolean accepts(String queryToken, String authorizationHeader) {
        return switch (mode) {
            case "token" -> !secretToken.isEmpty() && queryToken != null && MessageDigest.isEqual(
                    queryToken.getBytes(StandardCharsets.UTF_8), secretToken.getBytes(StandardCharsets.UTF_8));
            case "oidc" -> oidc(authorizationHeader);
            default -> false;
        };
    }

    private boolean oidc(String header) {
        if (header == null || !header.startsWith("Bearer ") || audience.isEmpty() || serviceAccountEmail.isEmpty() || keys == null) {
            return false;
        }
        try {
            DefaultJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
            processor.setJWSTypeVerifier(new DefaultJOSEObjectTypeVerifier<>(JOSEObjectType.JWT, null));
            processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, keys));
            processor.setJWTClaimsSetVerifier(new DefaultJWTClaimsVerifier<>(audience, null, Set.of("iss", "exp", "email")));
            JWTClaimsSet claims = processor.process(header.substring(7).strip(), null);
            String issuer = claims.getIssuer();
            boolean googleIssuer = "https://accounts.google.com".equals(issuer) || "accounts.google.com".equals(issuer);
            return googleIssuer && serviceAccountEmail.equals(claims.getStringClaim("email"))
                    && Boolean.TRUE.equals(claims.getBooleanClaim("email_verified"));
        } catch (Exception rejected) {
            return false;
        }
    }

    static List<String> issuers() {
        return List.of("https://accounts.google.com", "accounts.google.com");
    }
}
