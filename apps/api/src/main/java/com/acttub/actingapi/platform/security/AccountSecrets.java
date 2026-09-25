package com.acttub.actingapi.platform.security;

import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 계정이 오래 들고 있는 비밀 값 둘 — 탈퇴한 신원의 해시와, 제공자 해제에 쓸 토큰의 암호문.
 *
 * <p><b>저장하는 값마다 어느 키로 만들었는지를 접두사로 붙인다</b>(SOMA-528 결정 I-11).
 * {@code k1:} 은 전용 환경변수의 키, {@code d1:} 은 {@code JWT_SECRET} 에서 용도를 못박아 뽑은 키다.
 * 전용 키가 설정돼 있으면 그것으로 쓰고, 없으면 파생 키로 쓴다. 읽을 때는 접두사로 키를 고른다 —
 * 그래서 나중에 전용 키를 넣어도 그 전에 쓴 값이 어긋나지 않는다. 신원 해시는 3년을 가므로
 * (ADR-029) 이 표식 없이는 키를 한 번도 바꿀 수 없다. 접두사 없는 값은 없다.
 *
 * <p>해시는 HMAC-SHA256(provider, provider_uid)이다. 사람을 알아보게 하지 않으면서 같은 제공자
 * 계정이 다시 오는지만 알려 준다. 쓰임은 하나다 — 보관 동의 철회 요청의 본인 확인(운영자가 대조).
 *
 * <p>암호화는 인증 암호(AES-256-GCM)이고 값마다 새 nonce 를 쓴다. 변조된 암호문은 풀리지 않는다.
 */
public final class AccountSecrets {

    /** 전용 환경변수의 키로 만든 값. */
    static final String DEDICATED = "k1";

    /** {@code JWT_SECRET} 에서 파생한 키로 만든 값. */
    static final String DERIVED = "d1";

    private static final String HASH_PURPOSE = "acttub/identity-hash/v1";
    private static final String ENCRYPTION_PURPOSE = "acttub/provider-token/v1";
    private static final int NONCE_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final Map<String, byte[]> hashKeys = new LinkedHashMap<>();
    private final Map<String, byte[]> encryptionKeys = new LinkedHashMap<>();
    private final String hashVersion;
    private final String encryptionVersion;
    private final SecureRandom random = new SecureRandom();

    /**
     * @param jwtSecret 파생 키의 뿌리. 비어 있을 수 없다
     * @param identityHashKey {@code ACCOUNT_IDENTITY_HASH_KEY}. 비어 있으면 파생 키로 쓴다
     * @param tokenEncryptionKey {@code ACCOUNT_TOKEN_ENCRYPTION_KEY}. 비어 있으면 파생 키로 쓴다
     */
    public AccountSecrets(String jwtSecret, String identityHashKey, String tokenEncryptionKey) {
        if (jwtSecret == null || jwtSecret.isEmpty()) {
            throw new IllegalArgumentException("account secrets need a non-empty JWT secret");
        }
        hashKeys.put(DERIVED, derive(jwtSecret, HASH_PURPOSE));
        encryptionKeys.put(DERIVED, derive(jwtSecret, ENCRYPTION_PURPOSE));
        if (!isBlank(identityHashKey)) {
            hashKeys.put(DEDICATED, derive(identityHashKey, HASH_PURPOSE));
        }
        if (!isBlank(tokenEncryptionKey)) {
            encryptionKeys.put(DEDICATED, derive(tokenEncryptionKey, ENCRYPTION_PURPOSE));
        }
        this.hashVersion = hashKeys.containsKey(DEDICATED) ? DEDICATED : DERIVED;
        this.encryptionVersion = encryptionKeys.containsKey(DEDICATED) ? DEDICATED : DERIVED;
    }

    /** 전용 키가 하나라도 빠져 파생 키로 쓰고 있는가 — 기동 때 경고를 남기는 데 쓴다. */
    public boolean usesDerivedKey() {
        return DERIVED.equals(hashVersion) || DERIVED.equals(encryptionVersion);
    }

    /** 탈퇴한 신원에 남기는 해시. 지금 쓰는 키로 만든다. */
    public String identityHash(String provider, String providerUid) {
        return identityHash(hashVersion, provider, providerUid);
    }

    /**
     * 가진 키 전부로 만든 해시들. 운영자가 철회 요청의 본인 확인을 할 때, 옛 계정의 해시가 어느 키로
     * 만들어졌든 대조할 수 있게 한다.
     */
    public List<String> identityHashCandidates(String provider, String providerUid) {
        List<String> candidates = new ArrayList<>();
        for (String version : hashKeys.keySet()) {
            candidates.add(identityHash(version, provider, providerUid));
        }
        return candidates;
    }

    public String encrypt(String plaintext) {
        try {
            byte[] nonce = new byte[NONCE_BYTES];
            random.nextBytes(nonce);
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.ENCRYPT_MODE,
                    new SecretKeySpec(encryptionKeys.get(encryptionVersion), "AES"),
                    new GCMParameterSpec(TAG_BITS, nonce));
            byte[] sealed = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            byte[] packed = ByteBuffer.allocate(nonce.length + sealed.length).put(nonce).put(sealed).array();
            return encryptionVersion + ":" + Base64.getUrlEncoder().withoutPadding().encodeToString(packed);
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("failed to encrypt an account secret", failure);
        }
    }

    /**
     * @throws UnreadableSecret 접두사가 모르는 키를 가리키거나(전용 키를 뺐다), 값이 변조됐다
     */
    public String decrypt(String stored) {
        int split = stored == null ? -1 : stored.indexOf(':');
        byte[] key = split < 0 ? null : encryptionKeys.get(stored.substring(0, split));
        if (key == null) {
            throw new UnreadableSecret("no key for this value's key version");
        }
        try {
            byte[] packed = Base64.getUrlDecoder().decode(stored.substring(split + 1));
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(
                    Cipher.DECRYPT_MODE,
                    new SecretKeySpec(key, "AES"),
                    new GCMParameterSpec(TAG_BITS, packed, 0, NONCE_BYTES));
            return new String(
                    cipher.doFinal(packed, NONCE_BYTES, packed.length - NONCE_BYTES),
                    StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException failure) {
            throw new UnreadableSecret("the value does not open with its key", failure);
        }
    }

    private String identityHash(String version, String provider, String providerUid) {
        // 제공자 이름에는 줄바꿈이 없어 두 값의 경계가 모호해지지 않는다.
        byte[] digest = hmac(
                hashKeys.get(version),
                (provider + "\n" + providerUid).getBytes(StandardCharsets.UTF_8));
        return version + ":" + HexFormat.of().formatHex(digest);
    }

    private static byte[] derive(String secret, String purpose) {
        return hmac(secret.getBytes(StandardCharsets.UTF_8), purpose.getBytes(StandardCharsets.UTF_8));
    }

    private static byte[] hmac(byte[] key, byte[] message) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(message);
        } catch (GeneralSecurityException failure) {
            throw new IllegalStateException("HMAC-SHA256 is unavailable", failure);
        }
    }

    private static boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    /** 저장된 값을 풀 수 없다. 값 자체는 메시지에 싣지 않는다. */
    public static final class UnreadableSecret extends RuntimeException {
        UnreadableSecret(String message) {
            super(message);
        }

        UnreadableSecret(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
