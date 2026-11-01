package com.acttub.actingapi.feature.blog.app;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.blog.domain.BlogDraft;
import com.acttub.actingapi.feature.blog.domain.BlogPost;

/** 블로그 글 저장소 — {@code blog_posts} (app.blog, V80). */
public interface BlogRepository {

    /** 게시된 글, 새것부터. {@code category} 가 {@code null} 이면 전체. */
    List<BlogPost> published(String category, int limit);

    Optional<BlogPost> findPublished(String slug);

    /** 초안까지 전부, 새로 고친 것부터. */
    List<BlogPost> all();

    Optional<BlogPost> find(UUID id);

    /** 같은 slug 가 이미 있으면 비어 있다. */
    Optional<BlogPost> insert(BlogDraft draft, Instant publishedAt, Instant now);

    /** 다른 글이 같은 slug 를 쓰고 있으면 비어 있다. */
    Optional<BlogPost> update(UUID id, BlogDraft draft, Instant publishedAt, Instant now);
}
