package com.acttub.actingapi.feature.community.adapter.db;

import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Base64;
import java.util.Locale;
import java.util.UUID;

/**
 * Python community cursor와 교차 소비할 수 있는 opaque keyset cursor.
 *
 * <p>저장소 옆에 사는 이유는 속이 정렬 키(생성 시각 + id)여서다 — 무엇을 담을지는 질의의
 * {@code ORDER BY} 가 정하고, 바깥은 이것을 열어 보지 않는 문자열로만 다룬다.
 */
final class CommunityCursor {
    private CommunityCursor() {
    }

    static String encode(OffsetDateTime createdAt, UUID id) {
        OffsetDateTime utc = createdAt.withOffsetSameInstant(ZoneOffset.UTC);
        String stamp = "%04d-%02d-%02dT%02d:%02d:%02d".formatted(
                utc.getYear(),
                utc.getMonthValue(),
                utc.getDayOfMonth(),
                utc.getHour(),
                utc.getMinute(),
                utc.getSecond());
        int micros = utc.getNano() / 1_000;
        if (micros != 0) {
            stamp += String.format(Locale.ROOT, ".%06d", micros);
        }
        String raw = stamp + "+00:00|" + id;
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    static Cursor decode(String encoded) {
        try {
            String raw = new String(
                    Base64.getUrlDecoder().decode(encoded),
                    StandardCharsets.UTF_8);
            int separator = raw.indexOf('|');
            if (separator <= 0 || separator != raw.lastIndexOf('|') || separator == raw.length() - 1) {
                throw new IllegalArgumentException("invalid_cursor");
            }
            OffsetDateTime createdAt = OffsetDateTime.parse(raw.substring(0, separator));
            UUID id = UUID.fromString(raw.substring(separator + 1));
            return new Cursor(createdAt, id);
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("invalid_cursor", exception);
        }
    }

    record Cursor(OffsetDateTime createdAt, UUID id) {
    }
}
