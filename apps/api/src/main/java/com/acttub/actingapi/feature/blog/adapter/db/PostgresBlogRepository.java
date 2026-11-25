package com.acttub.actingapi.feature.blog.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.blog.app.BlogRepository;
import com.acttub.actingapi.feature.blog.domain.BlogDraft;
import com.acttub.actingapi.feature.blog.domain.BlogPost;
import com.acttub.actingapi.feature.blog.schema.BlogPostEntity;
import org.springframework.data.domain.Limit;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 블로그 글의 Postgres 구현 — {@code blog_posts}(V80). slug 유일은 DB 가 판정하고 0행으로 "이미 있다" 를 안다.
 *
 * <p>넣기·고치기는 HQL 에 {@code RETURNING} 이 없어 한 문장으로 쓴 뒤 영향 행 수가 1 이면 같은 트랜잭션에서 id 로 다시 읽는다.
 * 넣은 행·고친 행은 이 트랜잭션이 커밋까지 잡고 있어 읽은 값은 방금 쓴 값이다. 0 이면 다시 읽지 않는다(apps/api/CONTRACT.md §5-9).
 */
@Repository
class PostgresBlogRepository implements BlogRepository {

    private final BlogPostJpaRepository posts;
    private final TransactionTemplate transaction;

    PostgresBlogRepository(BlogPostJpaRepository posts, PlatformTransactionManager transactionManager) {
        this.posts = posts;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public List<BlogPost> published(String category, int limit) {
        return posts.published(category, Limit.of(limit)).stream().map(PostgresBlogRepository::map).toList();
    }

    @Override
    public Optional<BlogPost> findPublished(String slug) {
        return posts.findPublished(slug).map(PostgresBlogRepository::map);
    }

    @Override
    public List<BlogPost> all() {
        return posts.all().stream().map(PostgresBlogRepository::map).toList();
    }

    @Override
    public Optional<BlogPost> find(UUID id) {
        return posts.find(id).map(PostgresBlogRepository::map);
    }

    @Override
    public Optional<BlogPost> insert(BlogDraft draft, Instant publishedAt, Instant now) {
        UUID id = UUID.randomUUID();
        return transaction.execute(tx -> posts.insertUnlessSlugTaken(id, draft.slug(), draft.title(), draft.summary(),
                draft.category(), draft.coverImageUrl(), draft.bodyMarkdown(), draft.appCta(), draft.status(),
                publishedAt, now) == 0 ? Optional.<BlogPost>empty() : find(id));
    }

    @Override
    public Optional<BlogPost> update(UUID id, BlogDraft draft, Instant publishedAt, Instant now) {
        return transaction.execute(tx -> posts.updateUnlessSlugTaken(id, draft.slug(), draft.title(), draft.summary(),
                draft.category(), draft.coverImageUrl(), draft.bodyMarkdown(), draft.appCta(), draft.status(),
                publishedAt, now) == 0 ? Optional.<BlogPost>empty() : find(id));
    }

    private static BlogPost map(BlogPostEntity row) {
        BlogDraft draft = new BlogDraft(row.getSlug(), row.getTitle(), row.getSummary(), row.getCategory(),
                row.getCoverImageUrl(), row.getBodyMarkdown(), row.getAppCta(), row.getStatus(), row.getPublishedAt());
        return new BlogPost(row.getId(), draft, row.getAuthorName(), row.getPublishedAt(), row.getCreatedAt(),
                row.getUpdatedAt());
    }
}
