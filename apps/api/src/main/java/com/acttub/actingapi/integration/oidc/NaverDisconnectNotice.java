package com.acttub.actingapi.integration.oidc;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.Base64;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.SecretKeySpec;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 네이버 "연결 끊기 알림"의 검증과 복호화 — 네이버 로그인 개발가이드 §4.4.
 *
 * <p>네이버는 등록해 둔 Callback URL 로 {@code clientId}·{@code encryptUniqueId}·{@code timestamp}·
 * {@code signature} 를 POST 한다({@code application/x-www-form-urlencoded}).
 * <ul>
 *   <li>키(§4.4.2·§4.4.3 공통): {@code MD5(client secret)} 의 앞 16바이트.</li>
 *   <li>서명(§4.4.3): {@code HmacSHA256(키, "clientId=%s&encryptUniqueId=%s&timestamp=%s")} 를
 *       URL-safe Base64(패딩 없음)로 적은 것.</li>
 *   <li>이용자 식별자(§4.4.2): {@code base64(iv(16) + AES128/CBC/PKCS5(평문, 키))}.</li>
 * </ul>
 * MD5 와 CBC 는 우리가 고른 것이 아니라 네이버가 정한 규격이다.
 */
@Component
public class NaverDisconnectNotice {
    private static final int BLOCK = 16;

    private final String clientId;
    private final String clientSecret;

    public NaverDisconnectNotice(
            @Value("${NAVER_OAUTH_CLIENT_ID:}") String clientId,
            @Value("${NAVER_OAUTH_CLIENT_SECRET:}") String clientSecret) {
        this.clientId = clientId == null ? "" : clientId.strip();
        this.clientSecret = clientSecret == null ? "" : clientSecret.strip();
    }

    /**
     * 서명을 확인하고 끊긴 이용자의 네이버 식별자를 돌려준다.
     *
     * @throws ProviderConfigurationError Client ID·secret 이 없다
     * @throws InvalidProviderNotice 빠진 값이 있거나, 우리 앱의 알림이 아니거나, 서명이 맞지 않거나, 식별자가 풀리지 않는다
     */
    public String disconnectedUserId(String noticeClientId, String encryptUniqueId, String timestamp, String signature) {
        if (clientId.isEmpty() || clientSecret.isEmpty()) {
            throw new ProviderConfigurationError("NAVER_OAUTH_CLIENT_ID or NAVER_OAUTH_CLIENT_SECRET not configured");
        }
        if (noticeClientId == null || encryptUniqueId == null || timestamp == null || signature == null
                || !clientId.equals(noticeClientId)) {
            throw new InvalidProviderNotice();
        }
        try {
            byte[] key = key(clientSecret);
            String expected = sign(key, noticeClientId, encryptUniqueId, timestamp);
            if (!MessageDigest.isEqual(
                    expected.getBytes(StandardCharsets.US_ASCII),
                    stripPadding(signature).getBytes(StandardCharsets.US_ASCII))) {
                throw new InvalidProviderNotice();
            }
            byte[] packed = decode(encryptUniqueId);
            if (packed.length <= BLOCK) {
                throw new InvalidProviderNotice();
            }
            Cipher cipher = Cipher.getInstance("AES/CBC/PKCS5Padding");
            cipher.init(
                    Cipher.DECRYPT_MODE,
                    new SecretKeySpec(key, "AES"),
                    new IvParameterSpec(packed, 0, BLOCK));
            return new String(cipher.doFinal(packed, BLOCK, packed.length - BLOCK), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException unreadable) {
            throw new InvalidProviderNotice();
        }
    }

    static byte[] key(String clientSecret) throws GeneralSecurityException {
        return Arrays.copyOfRange(
                MessageDigest.getInstance("MD5").digest(clientSecret.getBytes(StandardCharsets.UTF_8)), 0, BLOCK);
    }

    static String sign(byte[] key, String clientId, String encryptUniqueId, String timestamp)
            throws GeneralSecurityException {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        String base = "clientId=%s&encryptUniqueId=%s&timestamp=%s".formatted(clientId, encryptUniqueId, timestamp);
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(mac.doFinal(base.getBytes(StandardCharsets.UTF_8)));
    }

    /** 문서의 예제는 URL-safe 로 적고 관대한 디코더로 읽는다. 두 글자 집합을 다 받는다. */
    private static byte[] decode(String value) {
        return Base64.getUrlDecoder().decode(stripPadding(value).replace('+', '-').replace('/', '_'));
    }

    private static String stripPadding(String value) {
        return value.replace("=", "");
    }
}
