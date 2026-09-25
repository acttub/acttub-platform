package com.acttub.actingapi.feature.challenge.app;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.Locale;
import java.util.UUID;

/** 대사 목록의 마지막 정렬 값. 요청자·탭·검색이 달라지면 재사용하지 않는다. */
public record ChallengeCursor(String tab, UUID viewer, String query, Instant at, UUID id, long likes, long entries) {
    public static ChallengeCursor decode(String raw, String tab, UUID viewer, String query) {
        if (raw == null || raw.isBlank()) return null;
        if (raw.length() > 4096) throw new IllegalArgumentException("cursor too long");
        String[] parts = new String(Base64.getUrlDecoder().decode(raw), StandardCharsets.UTF_8).split("\\|", -1);
        if (parts.length != 8 || !parts[0].equals("1") || !parts[1].equals(tab)
                || !parts[2].equals(viewer.toString())) throw new IllegalArgumentException("cursor scope changed");
        String search = new String(Base64.getUrlDecoder().decode(parts[3]), StandardCharsets.UTF_8);
        if (!search.equals(query.toLowerCase(Locale.ROOT))) throw new IllegalArgumentException("cursor search changed");
        long likes = Long.parseLong(parts[6]);
        long entries = Long.parseLong(parts[7]);
        if (likes < 0 || entries < 0) throw new IllegalArgumentException("invalid cursor counts");
        Instant at = Instant.parse(parts[4]);
        if (at.isBefore(Instant.parse("0001-01-01T00:00:00Z"))
                || at.isAfter(Instant.parse("9999-12-31T23:59:59.999999Z"))) throw new IllegalArgumentException("invalid cursor date");
        return new ChallengeCursor(tab, viewer, search, at, UUID.fromString(parts[5]), likes, entries);
    }

    public static String after(String tab, UUID viewer, String query, ChallengeRepository.Card card) {
        String search = Base64.getUrlEncoder().withoutPadding().encodeToString(query.toLowerCase(Locale.ROOT).getBytes(StandardCharsets.UTF_8));
        String value = String.join("|", "1", tab, viewer.toString(), search,
                ("ended".equals(tab) ? card.endsAt() : card.startsAt()).toString(), card.id().toString(),
                Long.toString(card.likeSum()), Long.toString(card.entryCount()));
        return Base64.getUrlEncoder().withoutPadding().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }
}
