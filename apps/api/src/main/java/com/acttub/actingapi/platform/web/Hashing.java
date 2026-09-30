package com.acttub.actingapi.platform.web;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;

/**
 * SHA-256 을 소문자 16진수 64자로. 요청 지문과 refresh 토큰 해시가 이 모양으로 저장돼 있어, 바꾸면 재전송이
 * 지문 불일치로 갈리고 저장된 토큰을 못 찾는다({@code RequestFingerprintPinTest} 가 고정한다).
 *
 * <p>무엇을 해시할지(정규 JSON 바이트인지, {@code |} 로 이은 문자열인지)는 부르는 자리가 정한다 — 자리마다
 * 달라서 여기로 모으면 지문이 바뀐다.
 */
public final class Hashing {
    private Hashing() {
    }

    public static String sha256Hex(byte[] bytes) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
        } catch (NoSuchAlgorithmException impossible) {
            throw new IllegalStateException("SHA-256 is unavailable", impossible);
        }
    }

    /** UTF-8 바이트의 해시. */
    public static String sha256Hex(String text) {
        return sha256Hex(text.getBytes(StandardCharsets.UTF_8));
    }
}
