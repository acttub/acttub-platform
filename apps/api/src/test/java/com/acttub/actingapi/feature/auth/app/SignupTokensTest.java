package com.acttub.actingapi.feature.auth.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import com.nimbusds.jose.EncryptionMethod;
import com.nimbusds.jose.JWEAlgorithm;
import com.nimbusds.jose.JWEHeader;
import com.nimbusds.jose.JWEObject;
import com.nimbusds.jose.Payload;
import com.nimbusds.jose.crypto.DirectEncrypter;
import org.junit.jupiter.api.Test;

/** 가입 토큰 — 같은 키로 암호화했어도 다른 용도·다른 방식·기한 밖이면 받지 않는다 (account.login). */
class SignupTokensTest {
    private static final Instant NOW = Instant.parse("2026-10-20T00:00:00Z");
    private final SignupTokens tokens = new SignupTokens("signup-secret");

    /** {@link SignupTokens} 가 쓰는 것과 같은 키 — 비밀값에서 용도 문자열로 파생한다. */
    private static byte[] key(int bytes) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec("signup-secret".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] derived = mac.doFinal("acttub/signup-token/v1".getBytes(StandardCharsets.UTF_8));
        return java.util.Arrays.copyOf(derived, bytes);
    }

    private static String encrypt(EncryptionMethod method, Map<String, Object> claims, int keyBytes) throws Exception {
        JWEObject token = new JWEObject(new JWEHeader(JWEAlgorithm.DIR, method), new Payload(claims));
        token.encrypt(new DirectEncrypter(key(keyBytes)));
        return token.serialize();
    }

    @Test
    void issuedTokenRoundTripsWithinItsLifetimeOnly() {
        SignupTokens.SignupIdentity identity = new SignupTokens.SignupIdentity("apple", "a-1", "a@b.c", "grant");
        String token = tokens.issue(identity, NOW);

        assertThat(tokens.decode(token, NOW.plusSeconds(SignupTokens.TTL_SECONDS - 1))).isEqualTo(identity);
        assertThatThrownBy(() -> tokens.decode(token, NOW.plusSeconds(SignupTokens.TTL_SECONDS)))
                .isInstanceOf(SignupTokens.InvalidSignupToken.class);
        assertThatThrownBy(() -> tokens.decode(token, NOW.minusSeconds(1)))
                .isInstanceOf(SignupTokens.InvalidSignupToken.class);
    }

    @Test
    void tokenOfAnotherTypeOrEncryptionIsRejected() throws Exception {
        long iat = NOW.getEpochSecond();
        assertThatThrownBy(() -> tokens.decode(
                encrypt(EncryptionMethod.A256GCM, Map.of("typ", "refresh", "iat", iat, "exp", iat + 60), 32), NOW))
                .isInstanceOf(SignupTokens.InvalidSignupToken.class)
                .hasMessage("not a signup token");
        assertThatThrownBy(() -> tokens.decode(
                encrypt(EncryptionMethod.A128GCM, Map.of("typ", "signup", "iat", iat, "exp", iat + 60), 16), NOW))
                .isInstanceOf(SignupTokens.InvalidSignupToken.class)
                .hasMessage("unsupported signup token header");
    }

    @Test
    void emptySecretFailsFast() {
        assertThatThrownBy(() -> new SignupTokens("")).hasMessage("signup token secret must not be empty");
        assertThatThrownBy(() -> new SignupTokens(null)).hasMessage("signup token secret must not be empty");
    }
}
