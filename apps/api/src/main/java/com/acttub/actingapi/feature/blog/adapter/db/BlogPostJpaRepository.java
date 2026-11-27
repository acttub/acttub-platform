package com.acttub.actingapi.feature.blog.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.blog.schema.BlogPostEntity;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code blog_posts} 를 읽고 쓰는 문장. slug 를 다투는 넣기·고치기는 한 문장이다(apps/api/CONTRACT.md §5-9). */
interface BlogPostJpaRepository extends Repository<BlogPostEntity, UUID> {

    @Query("""
            select p from BlogPostEntity p
            where p.status = 'published' and (:category is null or p.category = :category)
            order by p.publishedAt desc, p.id
            """)
    List<BlogPostEntity> published(String category, Limit limit);

    @Query("select p from BlogPostEntity p where p.status = 'published' and p.slug = :slug")
    Optional<BlogPostEntity> findPublished(String slug);

    @Query("select p from BlogPostEntity p order by p.updatedAt desc, p.id")
    List<BlogPostEntity> all();

    @Query("select p from BlogPostEntity p where p.id = :id")
    Optional<BlogPostEntity> find(UUID id);

    /** 같은 slug 가 있으면 0행이다. 함께 넣는 다른 트랜잭션이 있으면 그 커밋을 기다렸다가 판정한다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into BlogPostEntity (id, slug, title, summary, category, coverImageUrl, bodyMarkdown, appCta, status,
                                        publishedAt, createdAt, updatedAt)
            values (:id, :slug, :title, :summary, :category, :cover, :body, :cta, :status, :publishedAt, :now, :now)
            on conflict (slug) do nothing
            """)
    int insertUnlessSlugTaken(UUID id, String slug, String title, String summary, String category, String cover,
            String body, String cta, String status, Instant publishedAt, Instant now);

    /**
     * 다른 글이 그 slug 를 쓰면 0행이다. NOT EXISTS 는 문장 시작의 스냅숏으로 보므로, 함께 같은 slug 로 바꾸는 두 트랜잭션은
     * 둘 다 지나고 뒤의 것은 {@code uq_blog_posts_slug} 에서 막힌다. 그 위반은 {@code PostgresBlogRepository#update} 가 0행과
     * 같게 돌려준다.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update BlogPostEntity p
            set p.slug = :slug, p.title = :title, p.summary = :summary, p.category = :category,
                p.coverImageUrl = :cover, p.bodyMarkdown = :body, p.appCta = :cta, p.status = :status,
                p.publishedAt = :publishedAt, p.updatedAt = :now
            where p.id = :id
              and not exists (select 1 from BlogPostEntity o where o.slug = :slug and o.id <> :id)
            """)
    int updateUnlessSlugTaken(UUID id, String slug, String title, String summary, String category, String cover,
            String body, String cta, String status, Instant publishedAt, Instant now);
}
