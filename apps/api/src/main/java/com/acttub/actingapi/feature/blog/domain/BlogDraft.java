package com.acttub.actingapi.feature.blog.domain;

import java.time.Instant;

/** 운영자가 정하는 글의 칸. {@code publishedAt} 은 비워 두면 처음 게시할 때의 시각이 된다. */
public record BlogDraft(
        String slug,
        String title,
        String summary,
        String category,
        String coverImageUrl,
        String bodyMarkdown,
        String appCta,
        String status,
        Instant publishedAt) {
}
