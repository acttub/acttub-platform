package com.acttub.actingapi.integration.storage;

import java.util.Locale;
import java.util.Map;

/**
 * 사진으로 받는 형식 — JPEG·PNG·WebP·HEIC. 프로필 사진과 포트폴리오 사진이 같은 규칙을 쓴다.
 *
 * <p>앱은 올리기 전에 항상 긴 변 2048px 의 JPEG 로 줄인다. 이 검사와 {@link #MAX_BYTES} 는 앱을
 * 거치지 않은 올리기를 막는 <b>안전망</b>이라, 걸리면 영상 올리기와 같은 코드(415·413)로 답한다.
 */
public final class PhotoUploadType {

    public static final long MAX_BYTES = 10L * 1024 * 1024;

    private static final Map<String, String> SUFFIXES = Map.of(
            "image/jpeg", ".jpg",
            "image/png", ".png",
            "image/webp", ".webp",
            "image/heic", ".heic");

    private PhotoUploadType() {
    }

    /** 받는 형식이면 정규화한 MIME 타입, 아니면 {@code null}. */
    public static String accepted(String rawContentType) {
        if (rawContentType == null) {
            return null;
        }
        String normalized = rawContentType.strip().toLowerCase(Locale.ROOT);
        return SUFFIXES.containsKey(normalized) ? normalized : null;
    }

    public static String objectSuffix(String contentType) {
        return SUFFIXES.get(contentType);
    }
}
