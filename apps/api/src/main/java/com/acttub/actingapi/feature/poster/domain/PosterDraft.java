package com.acttub.actingapi.feature.poster.domain;

import java.time.Instant;
import java.util.List;

/**
 * 운영자가 정하는 포스터 한 장의 값 전부(app.poster). 식별자·revision·시각은 저장하는 쪽이 갖는다.
 *
 * <p>{@code image}·{@code audio} 는 {@code asset:<이름>}(앱 번들 자산) 또는 {@code posters/<uuid>.<ext>}(스토리지
 * 객체 키)다. {@code ctaTarget} 은 {@code route} 면 {@code /} 로, {@code url} 이면 {@code https://} 로 시작한다.
 */
public record PosterDraft(
        String slug,
        boolean active,
        int priority,
        Instant startsAt,
        Instant endsAt,
        List<String> platforms,
        String locale,
        String minAppVersion,
        String frequency,
        String audience,
        boolean dismissible,
        String badge,
        String title,
        String body,
        String image,
        String audio,
        String ctaLabel,
        String ctaAction,
        String ctaTarget,
        String footnote,
        String imageBg) {

    public PosterDraft {
        platforms = platforms == null ? null : List.copyOf(platforms);
    }
}
