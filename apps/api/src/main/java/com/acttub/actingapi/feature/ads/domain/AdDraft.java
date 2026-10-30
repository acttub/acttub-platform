package com.acttub.actingapi.feature.ads.domain;

import java.time.Instant;
import java.util.List;

/**
 * 운영자가 등록·수정하는 광고 한 건의 값(SOMA-876). 이미지 칸은 오브젝트 키({@code ads/<규격>/<uuid>.<png|jpg|webp>})
 * 이거나 http(s) 주소다. 학원 전용 칸(등록번호·교습과정·교습비)은 더 이상 받지 않는다 — 열은 남아 있다.
 */
public record AdDraft(
        String kind,
        String status,
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
        Instant startsAt,
        Instant endsAt,
        int sharePercent) {

    /** 우리 앱 광고 노출 비율 기본값(%) — 나머지는 AdMob. */
    public static final int DEFAULT_SHARE_PERCENT = 50;

    public AdDraft {
        slots = slots == null ? List.of() : List.copyOf(slots);
    }

    /** 처음 만들 때의 빈 값 — 켜진 채로 만든다. */
    public static AdDraft blank() {
        return new AdDraft(Ad.DIRECT, "active", List.of(), "all", 0, null, null, null, null, null, null, null, null,
                null, null, DEFAULT_SHARE_PERCENT);
    }
}
