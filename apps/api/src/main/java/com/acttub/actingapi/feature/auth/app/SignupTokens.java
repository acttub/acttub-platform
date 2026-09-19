package com.acttub.actingapi.feature.auth.app;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import com.nimbusds.jose.EncryptionMethod;
import com.nimbusds.jose.JWEAlgorithm;
import com.nimbusds.jose.JWEHeader;
import com.nimbusds.jose.JWEObject;
import com.nimbusds.jose.Payload;
import com.nimbusds.jose.crypto.DirectDecrypter;
import com.nimbusds.jose.crypto.DirectEncrypter;

/**
 * 가입 토큰 — 처음 온 신원이 동의 화면을 보는 30분 동안만 사는, <b>서버가 저장하지 않는</b> 토큰.
 *
 * <p>계정 행은 가입 제출이 통과한 순간에야 만든다. 그 전에는 제공자 신원과 이메일을 DB 에 두지
 * 않으므로(동의 없이 개인정보를 갖고 있지 않기 위해서다), 로그인에서 확인한 신원을 가입 제출까지
 * 들고 가는 그릇이 이것이다. 동의 화면에서 나가면 토큰은 버려지고 아무것도 남지 않는다.
 *
 * <p><b>서명이 아니라 암호화다</b>(JWE {@code dir} + {@code A256GCM}). 서명만 하면 앱이 내용을
 * 읽는데, 여기에는 제공자 ID·이메일과 (애플이면) 탈퇴 때 폐기에 쓸 애플 토큰이 들어 있다. GCM 이라
 * 위조도 함께 막힌다. 프로필은 담지 않는다 — 계정이 생긴 뒤에 입력하므로 맡아 둘 것이 없다.
 *
 * <p>키는 {@code JWT_SECRET} 에서 용도를 못박아 뽑는다(HMAC-SHA256). 액세스 토큰의 서명 키와 같은
 * 비밀에서 나오지만 같은 키는 아니다. 토큰이 30분만 살아서 비밀을 바꾸면 그 사이 가입 중이던
 * 사람만 로그인 버튼부터 다시 시작한다.
 */
public final class SignupTokens {

    public static final long TTL_SECONDS = 30 * 60;

    private static final String KEY_PURPOSE = "acttub/signup-token/v1";
    private static final String TYPE = "signup";

    private final byte[] key;

    public SignupTokens(String secret) {
        if (secret == null || secret.isEmpty()) {
            throw new IllegalArgumentException("signup token secret must not be empty");
        }
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            this.key = mac.doFinal(KEY_PURPOSE.getBytes(StandardCharsets.UTF_8));
        } catch (Exception failure) {
            throw new IllegalStateException("failed to derive the signup token key", failure);
        }
    }

    public String issue(SignupIdentity identity, Instant now) {
        Map<String, Object> claims = new LinkedHashMap<>();
        claims.put("typ", TYPE);
        claims.put("provider", identity.provider());
        claims.put("uid", identity.providerUid());
        claims.put("email", identity.verifiedEmail());
        claims.put("apple_token", identity.appleToken());
        claims.put("iat", now.getEpochSecond());
        claims.put("exp", now.getEpochSecond() + TTL_SECONDS);
        try {
            JWEObject token = new JWEObject(
                    new JWEHeader(JWEAlgorithm.DIR, EncryptionMethod.A256GCM),
                    new Payload(claims));
            token.encrypt(new DirectEncrypter(key));
            return token.serialize();
        } catch (Exception failure) {
            throw new IllegalStateException("failed to issue a signup token", failure);
        }
    }

    /** 위조·만료·다른 용도의 토큰은 이유를 가리지 않고 같은 예외다. */
    public SignupIdentity decode(String token, Instant now) {
        try {
            JWEObject parsed = JWEObject.parse(token);
            if (!JWEAlgorithm.DIR.equals(parsed.getHeader().getAlgorithm())
                    || !EncryptionMethod.A256GCM.equals(parsed.getHeader().getEncryptionMethod())) {
                throw new InvalidSignupToken("unsupported signup token header");
            }
            parsed.decrypt(new DirectDecrypter(key));
            Map<String, Object> claims = parsed.getPayload().toJSONObject();
            if (claims == null || !TYPE.equals(claims.get("typ"))) {
                throw new InvalidSignupToken("not a signup token");
            }
            long issuedAt = ((Number) claims.get("iat")).longValue();
            long expiresAt = ((Number) claims.get("exp")).longValue();
            long checked = now.getEpochSecond();
            if (issuedAt > checked || expiresAt <= checked) {
                throw new InvalidSignupToken("signup token is expired or not yet valid");
            }
            return new SignupIdentity(
                    (String) claims.get("provider"),
                    (String) claims.get("uid"),
                    (String) claims.get("email"),
                    (String) claims.get("apple_token"));
        } catch (InvalidSignupToken invalid) {
            throw invalid;
        } catch (Exception failure) {
            throw new InvalidSignupToken("invalid signup token", failure);
        }
    }

    /**
     * 로그인에서 확인한 신원.
     *
     * @param verifiedEmail 제공자가 검증했다고 알린 이메일(정규화된 값). 없거나 검증되지 않았으면
     *        {@code null} — 검증된 이메일만 저장한다
     * @param appleToken 애플이면 로그인 때 authorization code 로 바로 바꿔 온 토큰. 그 밖에는 {@code null}
     */
    public record SignupIdentity(
            String provider,
            String providerUid,
            String verifiedEmail,
            String appleToken) {
    }

    public static class InvalidSignupToken extends RuntimeException {
        public InvalidSignupToken(String message) {
            super(message);
        }

        public InvalidSignupToken(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
