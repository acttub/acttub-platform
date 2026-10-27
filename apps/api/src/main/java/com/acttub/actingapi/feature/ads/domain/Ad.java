package com.acttub.actingapi.feature.ads.domain;

import java.util.List;
import java.util.UUID;

/**
 * 직접(학원)·자체(우리 앱) 광고 한 건(SOMA-876, 표 {@code ads}). 고를 때 쓰는 값과 광고 상세 화면이 보이는 학원 정보를 함께 든다.
 * 기간·상태는 저장소가 거른 뒤라 여기엔 없다.
 */
public record Ad(
        UUID id,
        String kind,
        List<String> slots,
        String audience,
        int priority,
        String advertiserName,
        String academyRegistrationNo,
        String courseName,
        String tuition,
        String headline,
        String body,
        String imageLargeBanner,
        String imageBanner,
        String imageMediumRectangle,
        String linkUrl,
        String appPath) {

    public static final String DIRECT = "direct";
    public static final String HOUSE = "house";

    public Ad {
        slots = slots == null ? List.of() : List.copyOf(slots);
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

    static boolean blank(String value) {
        return value == null || value.isBlank();
    }
}
