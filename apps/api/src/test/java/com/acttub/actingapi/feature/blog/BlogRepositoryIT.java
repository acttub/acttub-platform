package com.acttub.actingapi.feature.blog;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.blog.app.BlogRepository;
import com.acttub.actingapi.feature.blog.domain.BlogDraft;
import com.acttub.actingapi.feature.blog.domain.BlogPost;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.ObjectMapper;

/**
 * 블로그 저장소의 여섯 문장이 내는 결과·잠금·경합·문장 수를 실제 PostgreSQL 에서 고정한다. 저장소를 네이티브 SQL 에서 JPA 로
 * 옮길 때 네이티브 구현에서 먼저 통과시킨 이 테스트가 그대로 통과해야 한다(apps/api/CONTRACT.md §5-9).
 *
 * <p>HTTP 쪽 값 검증·토큰·처음 게시 시각·응답 모양은 {@link BlogEndpointIT} 가 본다. 여기서는 그 테스트가 밟지 않는 모든 칸과
 * 기본값, 시각의 정밀도, 같은 시각의 정렬, 개수 제한, 없는 id, 잠금 세기, 같은 slug 를 두 요청이 함께 넣거나 바꿀 때 누가 이기고
 * 진 쪽이 무엇을 받는지, 포트 메서드마다 나가는 문장을 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ADMIN_OPS_TOKEN=admin-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.blog.BlogRepositoryIT$Recorder"
})
@AutoConfigureMockMvc
// 이 클래스만 쓰는 설정이라 끝나면 닫는다(BlogEndpointIT 와 같은 까닭).
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class BlogRepositoryIT {

    /** 이 스레드가 보낸 SQL 을 모은다. 경합 쪽 스레드의 문장은 섞이지 않는다. */
    public static class Recorder implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    private static final String ADMIN = "Bearer admin-secret";

    @Value("${spring.datasource.url}")
    private String databaseUrl;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    BlogRepository posts;

    @Autowired
    PlatformTransactionManager transactionManager;

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper mapper;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE blog_posts");
        Recorder.STATEMENTS.get().clear();
    }

    // ---- 포트 메서드마다 결과 ----

    @Test
    @DisplayName("insert 는 넘긴 칸과 시각을 적고 author_name 은 DB 기본값이다. 시각은 마이크로초로 반올림되고, 돌려준 글은 저장된 행과 같다")
    void insertWritesEveryColumnAndReturnsTheStoredRow() {
        Instant at = now.plusNanos(123_456_789);
        Instant publishedAt = now.minusSeconds(3600).plusNanos(1_500);
        BlogPost inserted = posts.insert(new BlogDraft("first-post", "제목", "요약", "news", "https://cdn.example/a.png",
                "## 본문", "reading", "published", null), publishedAt, at).orElseThrow();

        Instant rounded = now.plus(123_457, ChronoUnit.MICROS);
        Instant publishedRounded = now.minusSeconds(3600).plus(2, ChronoUnit.MICROS);
        assertThat(inserted.draft()).isEqualTo(new BlogDraft("first-post", "제목", "요약", "news",
                "https://cdn.example/a.png", "## 본문", "reading", "published", publishedRounded));
        assertThat(inserted.authorName()).isEqualTo("액터브 팀");
        assertThat(inserted.publishedAt()).isEqualTo(publishedRounded);
        assertThat(inserted.createdAt()).isEqualTo(rounded);
        assertThat(inserted.updatedAt()).isEqualTo(rounded);
        assertThat(posts.find(inserted.id())).contains(inserted);

        assertThat(jdbc.queryForMap("SELECT * FROM blog_posts WHERE id=?", inserted.id())).satisfies(row -> {
            assertThat(row.get("slug")).isEqualTo("first-post");
            assertThat(row.get("body_markdown")).isEqualTo("## 본문");
            assertThat(row.get("app_cta")).isEqualTo("reading");
            assertThat(row.get("author_name")).isEqualTo("액터브 팀");
        });
        assertThat(jdbc.queryForObject("SELECT created_at FROM blog_posts", OffsetDateTime.class).toInstant())
                .isEqualTo(rounded);
    }

    @Test
    @DisplayName("insert 는 표지·게시 시각이 없으면 NULL 로 적는다")
    void insertKeepsNullCoverAndPublishedAt() {
        BlogPost draft = posts.insert(draft("no-cover", "draft"), null, now).orElseThrow();

        assertThat(draft.draft().coverImageUrl()).isNull();
        assertThat(draft.publishedAt()).isNull();
        assertThat(draft.draft().publishedAt()).isNull();
        assertThat(jdbc.queryForMap("SELECT cover_image_url, published_at FROM blog_posts WHERE id=?", draft.id()))
                .containsEntry("cover_image_url", null).containsEntry("published_at", null);
    }

    @Test
    @DisplayName("insert 는 같은 slug 가 이미 있으면 비어 있고 있던 행을 건드리지 않는다")
    void insertWithATakenSlugIsEmptyAndChangesNothing() {
        BlogPost first = posts.insert(draft("taken", "draft"), null, now).orElseThrow();

        assertThat(posts.insert(new BlogDraft("taken", "다른 제목", "다른 요약", "practice", null, "다른 본문",
                "none", "published", null), now, now.plusSeconds(60))).isEmpty();

        assertThat(jdbc.queryForObject("SELECT count(*) FROM blog_posts", Integer.class)).isEqualTo(1);
        assertThat(posts.find(first.id())).contains(first);
    }

    @Test
    @DisplayName("update 는 모든 칸과 updated_at 을 바꾸고 created_at·author_name 은 두며 바뀐 글을 낸다. 자기 slug 는 그대로 써도 된다")
    void updateChangesEveryColumnAndReturnsTheChangedRow() {
        BlogPost before = posts.insert(new BlogDraft("old-slug", "옛 제목", "옛 요약", "news", "/cover.png", "옛 본문",
                "coaching", "published", null), now.minusSeconds(60), now.minusSeconds(60)).orElseThrow();
        Instant at = now.plusNanos(999_999);

        BlogPost changed = posts.update(before.id(), new BlogDraft("new-slug", "새 제목", "새 요약", "practice", null,
                "새 본문", "challenge", "draft", null), null, at).orElseThrow();

        assertThat(changed).isEqualTo(new BlogPost(before.id(), new BlogDraft("new-slug", "새 제목", "새 요약",
                "practice", null, "새 본문", "challenge", "draft", null), "액터브 팀", null,
                now.minusSeconds(60), now.plus(1, ChronoUnit.MILLIS)));
        assertThat(posts.find(before.id())).contains(changed);

        BlogPost same = posts.update(before.id(), new BlogDraft("new-slug", "새 제목", "새 요약", "practice", null,
                "새 본문", "challenge", "published", now), now, now.plusSeconds(1)).orElseThrow();
        assertThat(same.draft().slug()).isEqualTo("new-slug");
        assertThat(same.publishedAt()).isEqualTo(now);
        assertThat(same.updatedAt()).isEqualTo(now.plusSeconds(1));
    }

    @Test
    @DisplayName("update 는 다른 글이 그 slug 를 쓰면 비어 있고 아무것도 바꾸지 않는다. 없는 id 도 비어 있다")
    void updateToAnotherPostsSlugOrAMissingIdIsEmpty() {
        BlogPost one = posts.insert(draft("one", "draft"), null, now).orElseThrow();
        BlogPost two = posts.insert(draft("two", "draft"), null, now).orElseThrow();

        assertThat(posts.update(two.id(), draft("one", "published"), now, now.plusSeconds(60))).isEmpty();
        assertThat(posts.update(UUID.randomUUID(), draft("three", "draft"), null, now)).isEmpty();

        assertThat(posts.find(one.id())).contains(one);
        assertThat(posts.find(two.id())).contains(two);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM blog_posts", Integer.class)).isEqualTo(2);
    }

    @Test
    @DisplayName("published 는 게시된 글만 published_at 새것부터(같으면 id 작은 것부터) limit 건 낸다. category 가 null 이면 전체다")
    void publishedFiltersOrdersAndLimits() {
        row(id(1), "a-old", "practice", "published", now.minusSeconds(120), now);
        row(id(3), "a-tie-high", "news", "published", now, now);
        row(id(2), "a-tie-low", "practice", "published", now, now);
        row(id(4), "a-draft", "practice", "draft", now.plusSeconds(60), now);
        row(id(5), "a-draft-no-date", "news", "draft", null, now);

        assertThat(posts.published(null, 50)).extracting(BlogPost::id).containsExactly(id(2), id(3), id(1));
        assertThat(posts.published(null, 2)).extracting(BlogPost::id).containsExactly(id(2), id(3));
        assertThat(posts.published("practice", 50)).extracting(BlogPost::id).containsExactly(id(2), id(1));
        assertThat(posts.published("audition", 50)).isEmpty();
        assertThat(posts.published("practice", 50).getLast()).isEqualTo(stored(id(1), "a-old", "practice", "published",
                now.minusSeconds(120), now));
    }

    @Test
    @DisplayName("findPublished 는 게시된 글만 slug 로 찾는다. 초안·없는 slug 는 비어 있다")
    void findPublishedSkipsDrafts() {
        row(id(1), "live", "news", "published", now, now);
        row(id(2), "hidden", "news", "draft", now, now);

        assertThat(posts.findPublished("live")).contains(stored(id(1), "live", "news", "published", now, now));
        assertThat(posts.findPublished("hidden")).isEmpty();
        assertThat(posts.findPublished("missing")).isEmpty();
    }

    @Test
    @DisplayName("all 은 초안까지 updated_at 새것부터(같으면 id 작은 것부터) 낸다")
    void allOrdersByUpdatedAtThenId() {
        row(id(1), "oldest", "news", "published", now, now.minusSeconds(60));
        row(id(3), "tie-high", "news", "draft", null, now);
        row(id(2), "tie-low", "practice", "published", now, now);

        assertThat(posts.all()).extracting(BlogPost::id).containsExactly(id(2), id(3), id(1));
        assertThat(posts.all().get(1)).isEqualTo(stored(id(3), "tie-high", "news", "draft", null, now));
    }

    @Test
    @DisplayName("find 는 상태와 상관없이 id 로 찾고 없는 id 는 비어 있다")
    void findReadsAnyStatus() {
        row(id(1), "draft-one", "news", "draft", null, now);

        assertThat(posts.find(id(1))).contains(stored(id(1), "draft-one", "news", "draft", null, now));
        assertThat(posts.find(UUID.randomUUID())).isEmpty();
    }

    // ---- 잠금 ----

    @Test
    @DisplayName("update 는 slug 를 그대로 두면 FOR NO KEY UPDATE 세기라 바깥 FOR KEY SHARE 를 지나고, slug 를 바꾸면 유니크 키를 바꾸는 FOR UPDATE 세기라 그 뒤에서 기다린다")
    void updateLockStrengthDependsOnWhetherTheSlugChanges() throws Exception {
        row(id(1), "locked", "news", "draft", null, now);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            lock(probe, id(1), "FOR KEY SHARE");
            assertThat(pool.submit(() -> posts.update(id(1), draft("locked", "draft"), null, now.plusSeconds(1)))
                    .get(20, TimeUnit.SECONDS)).as("키 칸을 바꾸지 않으면 겹치지 않는다").isPresent();

            Future<Optional<BlogPost>> blocked = pool.submit(() ->
                    posts.update(id(1), draft("renamed", "draft"), null, now.plusSeconds(2)));
            String waiting = awaitStatementWaitingOn("blog_posts");
            probe.rollback();

            assertThat(waiting.toLowerCase(Locale.ROOT)).startsWith("update blog_posts");
            assertThat(blocked.get(20, TimeUnit.SECONDS)).map(post -> post.draft().slug()).contains("renamed");
        } finally {
            pool.shutdownNow();
        }
    }

    // ---- 경합: 같은 slug ----

    @Test
    @DisplayName("같은 slug 를 두 요청이 함께 넣으면 뒤의 INSERT 가 앞의 커밋을 기다렸다가 0행이 되어 409 slug_taken 을 받는다")
    void twoCreatesWithTheSameSlugTheLaterGets409() throws Exception {
        Race<Optional<BlogPost>> first = holdOpen(() -> posts.insert(draft("race", "draft"), null, now));
        try {
            Future<MockHttpServletResponse> second = first.pool.submit(() ->
                    admin(post("/v2/admin/blog/posts"), fields("race", "published")));
            assertThat(awaitStatementWaitingOn("blog_posts").toLowerCase(Locale.ROOT)).startsWith("insert into blog_posts");
            first.commit();

            assertThat(first.result()).isPresent();
            MockHttpServletResponse response = second.get(20, TimeUnit.SECONDS);
            assertThat(response.getStatus()).isEqualTo(409);
            assertThat(mapper.readTree(response.getContentAsString()).path("detail").stringValue(null))
                    .isEqualTo("slug_taken");
        } finally {
            first.pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT status FROM blog_posts WHERE slug='race'", String.class))
                .containsExactly("draft");
    }

    @Test
    @DisplayName("같은 slug 를 두 포트 호출이 함께 넣으면 뒤의 것은 비어 있다. 앞의 것이 되돌리면 뒤의 것이 넣는다")
    void twoInsertsWithTheSameSlugAtThePort() throws Exception {
        Race<Optional<BlogPost>> committed = holdOpen(() -> posts.insert(draft("race", "draft"), null, now));
        try {
            Future<Optional<BlogPost>> later = committed.pool.submit(() ->
                    posts.insert(draft("race", "published"), now, now));
            awaitStatementWaitingOn("blog_posts");
            committed.commit();
            assertThat(later.get(20, TimeUnit.SECONDS)).isEmpty();
        } finally {
            committed.pool.shutdownNow();
        }

        Race<Optional<BlogPost>> rolledBack = holdOpen(() -> posts.insert(draft("undo", "draft"), null, now));
        try {
            Future<Optional<BlogPost>> later = rolledBack.pool.submit(() ->
                    posts.insert(draft("undo", "published"), now, now));
            awaitStatementWaitingOn("blog_posts");
            rolledBack.rollback();
            assertThat(later.get(20, TimeUnit.SECONDS)).map(post -> post.draft().status()).contains("published");
        } finally {
            rolledBack.pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT slug || ':' || status FROM blog_posts ORDER BY slug", String.class))
                .containsExactly("race:draft", "undo:published");
    }

    @Test
    @DisplayName("두 글을 함께 같은 slug 로 바꾸면 둘 다 NOT EXISTS 를 지나고, 뒤의 것은 유니크 인덱스에서 앞의 커밋을 기다렸다가 유니크 위반으로 500 을 받는다")
    void twoUpdatesToTheSameSlugTheLaterGets500() throws Exception {
        row(id(1), "one", "news", "draft", null, now);
        row(id(2), "two", "news", "draft", null, now);
        Race<Optional<BlogPost>> first = holdOpen(() -> posts.update(id(1), draft("taken", "draft"), null, now));
        try {
            Future<MockHttpServletResponse> second = first.pool.submit(() ->
                    admin(patch("/v2/admin/blog/posts/" + id(2)), Map.of("slug", "taken")));
            assertThat(awaitStatementWaitingOn("blog_posts").toLowerCase(Locale.ROOT)).startsWith("update blog_posts");
            first.commit();

            assertThat(first.result()).map(post -> post.draft().slug()).contains("taken");
            MockHttpServletResponse response = second.get(20, TimeUnit.SECONDS);
            assertThat(response.getStatus()).isEqualTo(500);
            assertThat(mapper.readTree(response.getContentAsString()).path("detail").stringValue(null))
                    .isEqualTo("internal_server_error");
        } finally {
            first.pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT slug FROM blog_posts ORDER BY id", String.class))
                .containsExactly("taken", "two");
    }

    @Test
    @DisplayName("두 포트 호출이 함께 같은 slug 로 바꾸면 뒤의 것은 uq_blog_posts_slug 위반을 DataIntegrityViolationException 으로 받는다. 앞의 것이 되돌리면 뒤의 것이 바꾼다")
    void twoUpdatesToTheSameSlugAtThePort() throws Exception {
        row(id(1), "one", "news", "draft", null, now);
        row(id(2), "two", "news", "draft", null, now);
        Race<Optional<BlogPost>> committed = holdOpen(() -> posts.update(id(1), draft("taken", "draft"), null, now));
        try {
            Future<Optional<BlogPost>> later = committed.pool.submit(() ->
                    posts.update(id(2), draft("taken", "draft"), null, now));
            awaitStatementWaitingOn("blog_posts");
            committed.commit();

            Throwable thrown = catchThrowable(() -> later.get(20, TimeUnit.SECONDS)).getCause();
            assertThat(thrown).isExactlyInstanceOf(DataIntegrityViolationException.class);
            assertThat(sqlState(thrown)).isEqualTo("23505");
            assertThat(thrown).hasMessageContaining("uq_blog_posts_slug");
        } finally {
            committed.pool.shutdownNow();
        }

        Race<Optional<BlogPost>> rolledBack = holdOpen(() -> posts.update(id(1), draft("again", "draft"), null, now));
        try {
            Future<Optional<BlogPost>> later = rolledBack.pool.submit(() ->
                    posts.update(id(2), draft("again", "draft"), null, now));
            awaitStatementWaitingOn("blog_posts");
            rolledBack.rollback();
            assertThat(later.get(20, TimeUnit.SECONDS)).map(post -> post.draft().slug()).contains("again");
        } finally {
            rolledBack.pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT slug FROM blog_posts ORDER BY id", String.class))
                .containsExactly("taken", "again");
    }

    // ---- 문장 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류")
    void eachPortMethodSendsTheseStatements() {
        assertThat(statementsOf(() -> posts.insert(draft("counted", "published"), now, now)))
                .containsExactly("insert blog_posts on conflict returning");
        assertThat(statementsOf(() -> posts.insert(draft("counted", "draft"), null, now)))
                .as("같은 slug 가 있으면")
                .containsExactly("insert blog_posts on conflict returning");
        UUID id = jdbc.queryForObject("SELECT id FROM blog_posts", UUID.class);
        row(id(9), "other", "news", "draft", null, now);

        assertThat(statementsOf(() -> posts.update(id, draft("counted", "published"), now, now)))
                .containsExactly("update blog_posts not exists returning");
        assertThat(statementsOf(() -> posts.update(id, draft("other", "published"), now, now)))
                .as("다른 글이 그 slug 를 쓰면")
                .containsExactly("update blog_posts not exists returning");
        assertThat(statementsOf(() -> posts.published(null, 20))).containsExactly("select blog_posts");
        assertThat(statementsOf(() -> posts.published("news", 20))).containsExactly("select blog_posts");
        assertThat(statementsOf(() -> posts.findPublished("counted"))).containsExactly("select blog_posts");
        assertThat(statementsOf(() -> posts.all())).containsExactly("select blog_posts");
        assertThat(statementsOf(() -> posts.find(id))).containsExactly("select blog_posts");
    }

    // ---- 도움 ----

    private static final Pattern SELECT = Pattern.compile("^select .*? from (\\w+)\\b.*");
    private static final Pattern INSERT = Pattern.compile("^insert into (\\w+)\\b.*");
    private static final Pattern UPDATE = Pattern.compile("^update (\\w+)\\b.*");

    /** 문장을 "<종류> <표>[ 덧붙임]" 으로 줄인다. 별칭·열 목록·매개변수 표기는 두 구현이 달라 견주지 않는다. */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        String returning = text.contains(" returning ") ? " returning" : "";
        Matcher matcher;
        if ((matcher = SELECT.matcher(text)).matches()) {
            return "select " + matcher.group(1) + (text.contains(" for update") ? " for update" : "");
        }
        if ((matcher = INSERT.matcher(text)).matches()) {
            return "insert " + matcher.group(1) + (text.contains(" on conflict") ? " on conflict" : "") + returning;
        }
        if ((matcher = UPDATE.matcher(text)).matches()) {
            return "update " + matcher.group(1) + (text.contains("not exists") ? " not exists" : "") + returning;
        }
        return text;
    }

    private List<String> statementsOf(Supplier<?> call) {
        Recorder.STATEMENTS.get().clear();
        call.get();
        List<String> sent = Recorder.STATEMENTS.get().stream().map(BlogRepositoryIT::label).toList();
        Recorder.STATEMENTS.get().clear();
        return sent;
    }

    /** 첫 요청: 트랜잭션 안에서 포트를 부르고, 커밋하거나 되돌릴 때까지 열어 둔다. */
    private final class Race<T> {
        final ExecutorService pool = Executors.newFixedThreadPool(2);
        private final CountDownLatch done = new CountDownLatch(1);
        private final CountDownLatch release = new CountDownLatch(1);
        private volatile boolean rollback;
        private final Future<T> result;

        Race(Supplier<T> call) {
            TransactionTemplate transaction = new TransactionTemplate(transactionManager);
            result = pool.submit(() -> transaction.execute((TransactionStatus tx) -> {
                T value = call.get();
                done.countDown();
                await(release);
                if (rollback) {
                    tx.setRollbackOnly();
                }
                return value;
            }));
            await(done);
        }

        void commit() {
            release.countDown();
        }

        void rollback() {
            rollback = true;
            release.countDown();
        }

        T result() throws Exception {
            return result.get(20, TimeUnit.SECONDS);
        }
    }

    private <T> Race<T> holdOpen(Supplier<T> call) {
        return new Race<>(call);
    }

    private MockHttpServletResponse admin(MockHttpServletRequestBuilder request, Map<String, Object> payload)
            throws Exception {
        return mvc.perform(request.header("Authorization", ADMIN).contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(payload))).andReturn().getResponse();
    }

    private static Map<String, Object> fields(String slug, String status) {
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("slug", slug);
        fields.put("title", "목소리 풀기");
        fields.put("summary", "연습 전에 목을 푸는 방법");
        fields.put("category", "practice");
        fields.put("body_markdown", "## 본문");
        fields.put("app_cta", "coaching");
        fields.put("status", status);
        return fields;
    }

    private static BlogDraft draft(String slug, String status) {
        return new BlogDraft(slug, "제목", "요약", "news", null, "본문", "none", status, null);
    }

    private void row(UUID id, String slug, String category, String status, Instant publishedAt, Instant updatedAt) {
        jdbc.update("""
                INSERT INTO blog_posts(id,slug,title,summary,category,body_markdown,status,published_at,created_at,updated_at)
                VALUES (?,?,'제목','요약',?,'본문',?,?,?,?)
                """, id, slug, category, status,
                publishedAt == null ? null : OffsetDateTime.ofInstant(publishedAt, java.time.ZoneOffset.UTC),
                OffsetDateTime.ofInstant(now.minusSeconds(3600), java.time.ZoneOffset.UTC),
                OffsetDateTime.ofInstant(updatedAt, java.time.ZoneOffset.UTC));
    }

    /** {@link #row} 로 넣은 행을 포트가 낼 때의 값. */
    private BlogPost stored(UUID id, String slug, String category, String status, Instant publishedAt,
            Instant updatedAt) {
        return new BlogPost(id, new BlogDraft(slug, "제목", "요약", category, null, "본문", "none", status, publishedAt),
                "액터브 팀", publishedAt, now.minusSeconds(3600), updatedAt);
    }

    private static UUID id(int n) {
        return UUID.fromString("00000000-0000-0000-0000-%012d".formatted(n));
    }

    private Connection probe() throws SQLException {
        Connection probe = DriverManager.getConnection(databaseUrl,
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
        probe.setAutoCommit(false);
        return probe;
    }

    private static void lock(Connection probe, UUID id, String strength) throws SQLException {
        try (PreparedStatement statement = probe.prepareStatement("SELECT 1 FROM blog_posts WHERE id=? " + strength)) {
            statement.setObject(1, id);
            statement.execute();
        }
    }

    private static String sqlState(Throwable thrown) {
        for (Throwable cause = thrown; cause != null; cause = cause.getCause()) {
            if (cause instanceof SQLException sql) {
                return sql.getSQLState();
            }
        }
        return null;
    }

    private static void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(20, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exc);
        }
    }

    private String awaitStatementWaitingOn(String table) throws Exception {
        Instant deadline = Instant.now().plusSeconds(10);
        while (Instant.now().isBefore(deadline)) {
            List<String> waiting = jdbc.queryForList("""
                    SELECT query FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event_type='Lock'
                      AND query ILIKE ?
                    """, String.class, "%" + table + "%");
            if (!waiting.isEmpty()) {
                return waiting.getFirst().strip();
            }
            Thread.sleep(10);
        }
        throw new AssertionError("뒤의 요청이 앞의 잠금 뒤에서 기다리지 않았다");
    }
}
