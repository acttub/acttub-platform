package com.acttub.actingapi.feature.poster.app;

import java.time.Instant;

/**
 * 앱 공지사항 목록·상세의 공지 한 건. 팝업 포스터와 같은 제목·본문·이미지를 내고, 지금 팝업으로 떠 있는지({@code live})
 * 와 공지한 날({@code publishedAt} = 시작일, 없으면 만든 날)을 더한다.
 */
public record AppNotice(
        String slug,
        int revision,
        boolean live,
        Instant publishedAt,
        Instant endsAt,
        String badge,
        String title,
        String body,
        String imageUrl,
        String imageAsset,
        String ctaLabel,
        String ctaAction,
        String ctaTarget) {
}
