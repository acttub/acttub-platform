package com.acttub.actingapi.feature.poster.app;

/**
 * 앱에 내주는 포스터 한 장. 이미지는 {@code imageUrl}(스토리지, 1시간 주소)과 {@code imageAsset}(앱 번들 자산 이름) 중
 * 많아야 하나가 차 있고, 소리는 번들 자산만 낸다.
 */
public record AppPoster(
        String slug,
        int revision,
        String frequency,
        String audience,
        boolean dismissible,
        String badge,
        String title,
        String body,
        String imageUrl,
        String imageAsset,
        String audioAsset,
        String ctaLabel,
        String ctaAction,
        String ctaTarget) {
}
