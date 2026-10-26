package com.acttub.actingapi.feature.billing.adapter.store;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * RevenueCat 웹훅의 Authorization 헤더 확인(SOMA-818 2단계). 대시보드에 넣은 값({@code REVENUECAT_WEBHOOK_AUTH})과 헤더 전체가
 * 같아야 한다. 길이가 새지 않게 양쪽을 SHA-256 으로 줄인 뒤 상수 시간으로 비교한다. 설정이 비어 있으면 모두 거부한다.
 */
public class RevenueCatWebhookAuth {
    private final byte[] expected;

    public RevenueCatWebhookAuth(String secret) {
        String value = secret == null ? "" : secret.strip();
        this.expected = value.isEmpty() ? null : sha256(value);
    }

    public boolean configured() {
        return expected != null;
    }

    public boolean accepts(String authorization) {
        if (expected == null || authorization == null || authorization.isEmpty()) {
            return false;
        }
        return MessageDigest.isEqual(expected, sha256(authorization.strip()));
    }

    private static byte[] sha256(String value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
