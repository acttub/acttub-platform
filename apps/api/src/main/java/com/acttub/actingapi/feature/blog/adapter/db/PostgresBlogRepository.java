package com.acttub.actingapi.feature.blog.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.blog.app.BlogRepository;
import com.acttub.actingapi.feature.blog.domain.BlogDraft;
import com.acttub.actingapi.feature.blog.domain.BlogPost;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Query;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 블로그 글의 Postgres 구현 — {@code blog_posts}(V80). 행이 적어 Schema Entity 없이 native SQL 로만 읽고 쓴다
 * (CONTRACT §5-1, EntityMappingIT 의 대기 목록). slug 유일은 DB 가 판정하고 0행으로 "이미 있다" 를 안다.
 */
@Repository
class PostgresBlogRepository implements BlogRepository {

    private static final String COLUMNS = """
            id,slug,title,summary,category,cover_image_url,body_markdown,app_cta,status,author_name,
            published_at,created_at,updated_at""";

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresBlogRepository(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public List<BlogPost> published(String category, int limit) {
        return list(entityManager.createNativeQuery("SELECT " + COLUMNS + """
                 FROM blog_posts
                WHERE status='published' AND (CAST(:category AS text) IS NULL OR category=CAST(:category AS text))
                ORDER BY published_at DESC, id
                LIMIT :limit
                """, Tuple.class)
                .setParameter("category", category)
                .setParameter("limit", limit)).stream().map(PostgresBlogRepository::map).toList();
    }

    @Override
    public Optional<BlogPost> findPublished(String slug) {
        return list(entityManager.createNativeQuery(
                "SELECT " + COLUMNS + " FROM blog_posts WHERE status='published' AND slug=:slug", Tuple.class)
                .setParameter("slug", slug)).stream().map(PostgresBlogRepository::map).findFirst();
    }

    @Override
    public List<BlogPost> all() {
        return list(entityManager.createNativeQuery(
                "SELECT " + COLUMNS + " FROM blog_posts ORDER BY updated_at DESC, id", Tuple.class))
                .stream().map(PostgresBlogRepository::map).toList();
    }

    @Override
    public Optional<BlogPost> find(UUID id) {
        return list(entityManager.createNativeQuery(
                "SELECT " + COLUMNS + " FROM blog_posts WHERE id=:id", Tuple.class)
                .setParameter("id", id)).stream().map(PostgresBlogRepository::map).findFirst();
    }

    @Override
    public Optional<BlogPost> insert(BlogDraft draft, Instant publishedAt, Instant now) {
        UUID id = UUID.randomUUID();
        return transaction.execute(tx -> firstOrEmpty(bind(entityManager.createNativeQuery("""
                INSERT INTO blog_posts(id,slug,title,summary,category,cover_image_url,body_markdown,app_cta,status,
                                       published_at,created_at,updated_at)
                VALUES (:id,:slug,:title,:summary,:category,CAST(:cover AS text),:body,:cta,:status,
                        CAST(:publishedAt AS timestamptz),:now,:now)
                ON CONFLICT (slug) DO NOTHING
                RETURNING """ + " " + COLUMNS, Tuple.class), draft, publishedAt)
                .setParameter("id", id)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))));
    }

    @Override
    public Optional<BlogPost> update(UUID id, BlogDraft draft, Instant publishedAt, Instant now) {
        return transaction.execute(tx -> firstOrEmpty(bind(entityManager.createNativeQuery("""
                UPDATE blog_posts SET slug=:slug,title=:title,summary=:summary,category=:category,
                       cover_image_url=CAST(:cover AS text),body_markdown=:body,app_cta=:cta,status=:status,
                       published_at=CAST(:publishedAt AS timestamptz),updated_at=:now
                 WHERE id=:id AND NOT EXISTS (SELECT 1 FROM blog_posts o WHERE o.slug=:slug AND o.id<>:id)
                RETURNING """ + " " + COLUMNS, Tuple.class), draft, publishedAt)
                .setParameter("id", id)
                .setParameter("now", now.atOffset(ZoneOffset.UTC))));
    }

    private static Query bind(Query query, BlogDraft draft, Instant publishedAt) {
        return query
                .setParameter("slug", draft.slug())
                .setParameter("title", draft.title())
                .setParameter("summary", draft.summary())
                .setParameter("category", draft.category())
                .setParameter("cover", draft.coverImageUrl())
                .setParameter("body", draft.bodyMarkdown())
                .setParameter("cta", draft.appCta())
                .setParameter("status", draft.status())
                .setParameter("publishedAt", publishedAt == null ? null : publishedAt.atOffset(ZoneOffset.UTC));
    }

    private static Optional<BlogPost> firstOrEmpty(Query query) {
        return list(query).stream().map(PostgresBlogRepository::map).findFirst();
    }

    private static BlogPost map(Tuple row) {
        Instant publishedAt = row.get("published_at", Instant.class);
        BlogDraft draft = new BlogDraft(
                row.get("slug", String.class), row.get("title", String.class), row.get("summary", String.class),
                row.get("category", String.class), row.get("cover_image_url", String.class),
                row.get("body_markdown", String.class), row.get("app_cta", String.class),
                row.get("status", String.class), publishedAt);
        return new BlogPost(row.get("id", UUID.class), draft, row.get("author_name", String.class), publishedAt,
                row.get("created_at", Instant.class), row.get("updated_at", Instant.class));
    }
}
