package com.acttub.actingapi.feature.challenge.adapter.db;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;

import com.acttub.actingapi.platform.web.ApiValidationException;

/**
 * 참여작·댓글·저장 목록의 커서 — {@code 종류|값|값…} 을 URL-safe Base64 로 싼다. 종류와 칸 수가 다르거나 읽을 수
 * 없으면 422 다. 대사 목록의 커서는 모양이 달라 {@code app/ChallengeCursor} 가 따로 맡는다.
 */
final class Cursors {
    private Cursors() { }

    static String encode(String kind, String... parts) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(
                (kind + "|" + String.join("|", parts)).getBytes(StandardCharsets.UTF_8));
    }

    static String[] decode(String raw, String kind, int size) {
        try {
            if (raw.length() > 512) throw new IllegalArgumentException();
            String[] parts = new String(Base64.getUrlDecoder().decode(raw), StandardCharsets.UTF_8).split("\\|", -1);
            if (parts.length != size + 1 || !parts[0].equals(kind)) throw new IllegalArgumentException();
            return parts;
        } catch (IllegalArgumentException invalid) {
            throw invalidCursor(raw);
        }
    }

    static ApiValidationException invalidCursor(String raw) {
        return ApiValidationException.valueError(List.of("query", "cursor"), "Value error, invalid cursor", raw);
    }
}
