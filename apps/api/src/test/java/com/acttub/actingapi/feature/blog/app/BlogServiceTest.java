package com.acttub.actingapi.feature.blog.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.blog.domain.BlogDraft;
import com.acttub.actingapi.feature.blog.domain.BlogPost;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class BlogServiceTest {
    private final Instant now = Instant.parse("2026-10-31T00:00:00Z");
    private final Map<UUID, BlogPost> rows = new LinkedHashMap<>();
    private final Map<String, byte[]> uploaded = new LinkedHashMap<>();

    private final BlogRepository repository = new BlogRepository() {
        @Override
        public List<BlogPost> published(String category, int limit) {
            return rows.values().stream().filter(p -> "published".equals(p.draft().status()))
                    .filter(p -> category == null || category.equals(p.draft().category())).limit(limit).toList();
        }

        @Override
        public Optional<BlogPost> findPublished(String slug) {
            return rows.values().stream()
                    .filter(p -> "published".equals(p.draft().status()) && p.draft().slug().equals(slug)).findFirst();
        }

        @Override
        public List<BlogPost> all() {
            return new ArrayList<>(rows.values());
        }

        @Override
        public Optional<BlogPost> find(UUID id) {
            return Optional.ofNullable(rows.get(id));
        }

        @Override
        public Optional<BlogPost> insert(BlogDraft draft, Instant publishedAt, Instant at) {
            if (rows.values().stream().anyMatch(p -> p.draft().slug().equals(draft.slug()))) {
                return Optional.empty();
            }
            BlogPost post = new BlogPost(UUID.randomUUID(), draft, "액터브 팀", publishedAt, at, at);
            rows.put(post.id(), post);
            return Optional.of(post);
        }

        @Override
        public Optional<BlogPost> update(UUID id, BlogDraft draft, Instant publishedAt, Instant at) {
            if (rows.values().stream().anyMatch(p -> !p.id().equals(id) && p.draft().slug().equals(draft.slug()))) {
                return Optional.empty();
            }
            BlogPost post = new BlogPost(id, draft, "액터브 팀", publishedAt, rows.get(id).createdAt(), at);
            rows.put(id, post);
            return Optional.of(post);
        }
    };

    private final BlogImages images = new BlogImages() {
        @Override
        public void upload(String objectKey, String contentType, byte[] content) {
            uploaded.put(objectKey, content);
        }

        @Override
        public String viewUrl(String objectKey, int expiresInSeconds) {
            return uploaded.containsKey(objectKey) ? "https://s3.example/" + objectKey : null;
        }
    };

    private final BlogService service = new BlogService(repository, images, Clock.fixed(now, ZoneOffset.UTC));

    private static BlogDraft draft(String slug, String status) {
        return new BlogDraft(slug, "제목", "요약", "practice", null, "본문입니다", "coaching", status, null);
    }

    @Test
    @DisplayName("처음 게시하면 published_at 이 지금으로 채워지고 초안은 비어 있다")
    void publishSetsPublishedAtOnce() {
        BlogPost saved = service.create(draft("a", "draft"));
        assertThat(saved.publishedAt()).isNull();

        BlogPost first = service.update(saved.id(), d -> withStatus(d, "published"));
        assertThat(first.publishedAt()).isEqualTo(now);

        BlogService later = new BlogService(repository, images, Clock.fixed(now.plusSeconds(3600), ZoneOffset.UTC));
        BlogPost down = later.update(saved.id(), d -> withStatus(d, "draft"));
        BlogPost again = later.update(saved.id(), d -> withStatus(d, "published"));
        assertThat(down.publishedAt()).isEqualTo(now);
        assertThat(again.publishedAt()).isEqualTo(now);
    }

    @Test
    @DisplayName("보낸 published_at 은 그대로 쓴다")
    void providedPublishedAtWins() {
        Instant given = Instant.parse("2026-01-01T00:00:00Z");
        BlogDraft d = draft("b", "published");
        BlogPost saved = service.create(new BlogDraft(d.slug(), d.title(), d.summary(), d.category(), null,
                d.bodyMarkdown(), d.appCta(), d.status(), given));
        assertThat(saved.publishedAt()).isEqualTo(given);
    }

    @Test
    @DisplayName("같은 slug 는 409 slug_taken, 없는 글은 404 post_not_found")
    void conflictsAndMissing() {
        BlogPost first = service.create(draft("a", "draft"));
        service.create(draft("b", "draft"));
        assertThatThrownBy(() -> service.create(draft("a", "draft")))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(409));
        assertThatThrownBy(() -> service.update(first.id(), d -> new BlogDraft("b", d.title(), d.summary(),
                d.category(), null, d.bodyMarkdown(), d.appCta(), d.status(), null)))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(409));
        assertThatThrownBy(() -> service.update(UUID.randomUUID(), d -> d))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(404));
    }

    @Test
    @DisplayName("공개 읽기는 초안을 404 로 가리고 잘못된 분류·limit 은 422 다")
    void publicReads() {
        service.create(draft("draft-one", "draft"));
        service.create(draft("live-one", "published"));
        assertThat(service.published(null, 20)).hasSize(1);
        assertThat(service.published("news", 20)).isEmpty();
        assertThat(service.published("live-one").draft().slug()).isEqualTo("live-one");
        assertThatThrownBy(() -> service.published("draft-one"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(404));
        assertThatThrownBy(() -> service.published("bad", 20)).isInstanceOf(ApiValidationException.class);
        assertThatThrownBy(() -> service.published(null, 0)).isInstanceOf(ApiValidationException.class);
        assertThatThrownBy(() -> service.published(null, 51)).isInstanceOf(ApiValidationException.class);
    }

    @Test
    @DisplayName("이미지는 PNG·JPEG·WebP 2MB 까지, 올린 것은 blog/ 키로 저장되고 공개 주소로 읽힌다")
    void imageUpload() {
        String url = service.uploadImage("image/png", new byte[] {1, 2, 3});
        assertThat(url).startsWith("/v2/blog/images/").endsWith(".png");
        String name = url.substring("/v2/blog/images/".length());
        assertThat(uploaded).containsKey("blog/" + name);
        assertThat(service.imageLocation(name)).isEqualTo("https://s3.example/blog/" + name);

        assertThatThrownBy(() -> service.uploadImage("image/gif", new byte[1]))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(415));
        assertThatThrownBy(() -> service.uploadImage("image/png", new byte[(int) BlogService.MAX_IMAGE_BYTES + 1]))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(413));
        assertThat(service.uploadImage("image/webp", new byte[(int) BlogService.MAX_IMAGE_BYTES])).endsWith(".webp");
        for (String bad : new String[] {"../x.png", "nope.png", UUID.randomUUID() + ".png"}) {
            assertThatThrownBy(() -> service.imageLocation(bad))
                    .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(404));
        }
    }

    private static BlogDraft withStatus(BlogDraft d, String status) {
        return new BlogDraft(d.slug(), d.title(), d.summary(), d.category(), d.coverImageUrl(), d.bodyMarkdown(),
                d.appCta(), status, d.publishedAt());
    }
}
