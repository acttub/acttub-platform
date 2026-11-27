package com.acttub.actingapi.feature.ads.domain;

import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 직접(광고주)·자체(우리 앱) 광고 한 건(SOMA-876, 표 {@code ads}). 고를 때 쓰는 값이다. 광고주 정보는 광고주 쪽 페이지가 보이므로 앱은 link_url 만 연다.
 * 기간·상태는 저장소가 거른 뒤라 여기엔 없다.
 */
public record Ad(
        UUID id,
        String kind,
        List<String> slots,
        String audience,
        int priority,
        String advertiserName,
        String headline,
        String body,
        String imageLargeBanner,
        String imageBanner,
        String imageMediumRectangle,
        String linkUrl,
        String appPath,
        int sharePercent,
        Set<UUID> excludedUserIds) {

    public static final String DIRECT = "direct";
    public static final String HOUSE = "house";

    public Ad {
        slots = slots == null ? List.of() : List.copyOf(slots);
        excludedUserIds = excludedUserIds == null ? Set.of() : Set.copyOf(excludedUserIds);
    }

    /** 이 사람에게는 보이지 않는 광고인가(SOMA-1069, 운영자가 SQL 로 넣은 계정 목록). 사람을 모르면 false. */
    public boolean excludes(UUID userId) {
        return userId != null && excludedUserIds.contains(userId);
    }

    /** 이 규격의 이미지 주소. 없으면 null. */
    public String imageFor(AdSize size) {
        String url = switch (size) {
            case LARGE_BANNER -> imageLargeBanner;
            case BANNER -> imageBanner;
            case MEDIUM_RECTANGLE -> imageMediumRectangle;
        };
        return blank(url) ? null : url;
    }

    public boolean targets(AdSlot slot) {
        return slots.contains(slot.key());
    }

    public static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
