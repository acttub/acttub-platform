package com.acttub.actingapi.integration.admob;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.KeyPairGenerator;
import java.security.Signature;
import java.security.spec.ECGenParameterSpec;
import java.time.Instant;
import java.util.Base64;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import com.acttub.actingapi.integration.admob.AdMobRewardVerifier.AdMobKeysUnavailable;
import com.acttub.actingapi.support.MutableClock;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** AdMob SSV 서명 검사(SOMA-1067) — 진짜 ECDSA 키로 서명해 본다. 네트워크는 쓰지 않는다. */
class AdMobRewardVerifierTest {
    static final long KEY_ID = 3335741209L;
    static final String CONTENT = "ad_network=5450213213286189855&ad_unit=1234567890&custom_data=0f8fad5b-d9cb-469f-a165-70867728950e"
            + "&reward_amount=1&reward_item=coaching&timestamp=1761181200000&transaction_id=123456789"
            + "&user_id=33333333-3333-4333-8333-333333333333";

    final KeyPair pair = newPair();
    final MutableClock clock = new MutableClock(Instant.parse("2026-11-24T01:00:00Z"));
    final AtomicInteger fetches = new AtomicInteger();
    final AtomicReference<String> keysBody = new AtomicReference<>(keys(KEY_ID, pair));
    final AdMobRewardVerifier verifier = new AdMobRewardVerifier(() -> {
        fetches.incrementAndGet();
        String body = keysBody.get();
        if (body == null) {
            throw new AdMobKeysUnavailable("down");
        }
        return body;
    }, clock);

    @Test
    @DisplayName("signature 앞까지의 쿼리에 대한 ECDSA 서명(web-safe base64, 패딩 없음)이 맞으면 true")
    void acceptsAValidSignature() {
        assertThat(verifier.verify(CONTENT + "&signature=" + sign(CONTENT, pair) + "&key_id=" + KEY_ID)).isTrue();
    }

    @Test
    @DisplayName("값을 하나라도 바꾸거나, 다른 키로 서명했거나, 서명·키 id 가 없으면 false")
    void rejectsTamperingAndMissingParts() {
        String signature = sign(CONTENT, pair);
        assertThat(verifier.verify(CONTENT.replace("transaction_id=123456789", "transaction_id=123456780")
                + "&signature=" + signature + "&key_id=" + KEY_ID)).isFalse();
        assertThat(verifier.verify(CONTENT + "&signature=" + sign(CONTENT, newPair()) + "&key_id=" + KEY_ID)).isFalse();
        assertThat(verifier.verify(CONTENT + "&key_id=" + KEY_ID)).isFalse();
        assertThat(verifier.verify(CONTENT + "&signature=" + signature)).isFalse();
        assertThat(verifier.verify(CONTENT + "&signature=%%%&key_id=" + KEY_ID)).isFalse();
        assertThat(verifier.verify(null)).isFalse();
        assertThat(verifier.verify("signature=" + signature + "&key_id=" + KEY_ID)).isFalse();
    }

    @Test
    @DisplayName("키는 기억하고, 모르는 key_id 가 오면 1분에 한 번까지만 다시 받는다(키 교체)")
    void cachesKeysAndRefetchesForUnknownIdsAtMostOncePerMinute() {
        String valid = CONTENT + "&signature=" + sign(CONTENT, pair) + "&key_id=" + KEY_ID;
        assertThat(verifier.verify(valid)).isTrue();
        assertThat(verifier.verify(valid)).isTrue();
        assertThat(fetches.get()).isEqualTo(1);

        KeyPair rotated = newPair();
        keysBody.set(keys(42L, rotated));
        String withNewKey = CONTENT + "&signature=" + sign(CONTENT, rotated) + "&key_id=42";
        assertThat(verifier.verify(withNewKey)).as("1분 안에는 다시 받지 않는다").isFalse();
        assertThat(fetches.get()).isEqualTo(1);
        clock.set(clock.instant().plusSeconds(61));
        assertThat(verifier.verify(withNewKey)).isTrue();
        assertThat(fetches.get()).isEqualTo(2);
    }

    @Test
    @DisplayName("키를 한 번도 받지 못했으면 AdMobKeysUnavailable(5xx 로 답해 AdMob 이 다시 보내게), 받은 키가 있으면 그것으로 검사")
    void unavailableOnlyWhenNoKeysWereEverLoaded() {
        keysBody.set(null);
        String valid = CONTENT + "&signature=" + sign(CONTENT, pair) + "&key_id=" + KEY_ID;
        assertThatThrownBy(() -> verifier.verify(valid)).isInstanceOf(AdMobKeysUnavailable.class);

        keysBody.set(keys(KEY_ID, pair));
        clock.set(clock.instant().plusSeconds(61));
        assertThat(verifier.verify(valid)).isTrue();
        keysBody.set(null);
        clock.set(clock.instant().plus(AdMobRewardVerifier.KEY_TTL).plusSeconds(1));
        assertThat(verifier.verify(valid)).as("다시 받기가 실패해도 갖고 있던 키로").isTrue();
    }

    @Test
    @DisplayName("쿼리 값은 URL 디코딩해 읽는다")
    void paramsAreDecoded() {
        assertThat(AdMobRewardVerifier.params("a=1&user_id=x%2By&custom_data=&b"))
                .containsEntry("a", "1").containsEntry("user_id", "x+y").containsEntry("custom_data", "").containsEntry("b", "");
    }

    static KeyPair newPair() {
        try {
            KeyPairGenerator generator = KeyPairGenerator.getInstance("EC");
            generator.initialize(new ECGenParameterSpec("secp256r1"));
            return generator.generateKeyPair();
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    static String sign(String content, KeyPair pair) {
        try {
            Signature signer = Signature.getInstance("SHA256withECDSA");
            signer.initSign(pair.getPrivate());
            signer.update(content.getBytes(StandardCharsets.UTF_8));
            return Base64.getUrlEncoder().withoutPadding().encodeToString(signer.sign());
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** Google 이 내는 모양 — keyId 는 숫자, base64 는 X.509 SubjectPublicKeyInfo. */
    static String keys(long keyId, KeyPair pair) {
        String base64 = Base64.getEncoder().encodeToString(pair.getPublic().getEncoded());
        return "{\"keys\":[{\"keyId\":" + keyId + ",\"pem\":\"-----BEGIN PUBLIC KEY-----\\n" + base64
                + "\\n-----END PUBLIC KEY-----\",\"base64\":\"" + base64 + "\"}]}";
    }
}
