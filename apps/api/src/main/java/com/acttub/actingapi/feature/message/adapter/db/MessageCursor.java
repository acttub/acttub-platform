package com.acttub.actingapi.feature.message.adapter.db;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.UUID;

/**
 * 대화 목록과 메시지 목록의 keyset 커서. 속은 정렬 키(시각 + id)이고, 바깥은 열어 보지 않는 문자열로만 다룬다.
 * 우리가 만든 형태가 아니면 400 {@code invalid_cursor} 다.
 */
final class MessageCursor {
    private MessageCursor() {
    }

    static String encode(Instant at, UUID id) {
        String raw = at + "|" + id;
        return Base64.getUrlEncoder().withoutPadding().encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    /** @throws IllegalArgumentException 우리가 만든 형태가 아니면 */
    static Cursor decode(String encoded) {
        try {
            String raw = new String(Base64.getUrlDecoder().decode(encoded), StandardCharsets.UTF_8);
            int separator = raw.indexOf('|');
            if (separator <= 0 || separator != raw.lastIndexOf('|')) {
                throw new IllegalArgumentException("invalid_cursor");
            }
            return new Cursor(Instant.parse(raw.substring(0, separator)), UUID.fromString(raw.substring(separator + 1)));
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("invalid_cursor", exception);
        }
    }

    record Cursor(Instant at, UUID id) {
    }
}
