package com.acttub.actingapi.feature.blog.domain;

import java.time.Instant;
import java.util.UUID;

/** 저장된 글 한 편(blog_posts). */
public record BlogPost(
        UUID id,
        BlogDraft draft,
        String authorName,
        Instant publishedAt,
        Instant createdAt,
        Instant updatedAt) {

    public int readingMinutes() {
        return BlogRules.readingMinutes(draft.bodyMarkdown());
    }
}
