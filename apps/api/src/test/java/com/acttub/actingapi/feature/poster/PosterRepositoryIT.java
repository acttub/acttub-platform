package com.acttub.actingapi.feature.poster;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
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

import com.acttub.actingapi.feature.poster.app.PosterRepository;
import com.acttub.actingapi.feature.poster.domain.Poster;
import com.acttub.actingapi.feature.poster.domain.PosterDraft;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
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
 * 포스터 저장소의 여섯 문장이 내는 결과·잠금·경합·문장 수를 실제 PostgreSQL 에서 고정한다. 저장소를 네이티브 SQL 에서 JPA 로
 * 옮길 때 네이티브 구현에서 먼저 통과시킨 이 테스트가 그대로 통과했다(apps/api/CONTRACT.md §5-9). 문장 테스트만 달라졌다 —
 * 넣기({@code WITH … INSERT … ON CONFLICT DO NOTHING RETURNING})와 고치기({@code WITH … UPDATE … NOT EXISTS … RETURNING})를
 * 한 문장으로 쓴 뒤 다시 읽기로 나눠 쓴 행이 있을 때 하나 늘었다. 결과·잠금·경합 테스트는 고치지 않았다.
 *
 * <p>HTTP 쪽 값 검증·토큰·앱 버전 거르기·응답 모양은 {@link PosterEndpointIT} 가 본다. 여기서는 그 테스트가 밟지 않는 모든 칸,
 * 플랫폼 배열의 순서, 기간의 경계, 같은 값의 정렬, 언어 없음(NULL)까지 묶는 유일 판정, revision 올리기, 잠금 세기, 같은
 * {@code (slug, locale)} 을 두 요청이 함께 넣거나 바꿀 때 누가 이기고 진 쪽이 무엇을 받는지, 포트 메서드마다 나가는 문장을 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "ADMIN_OPS_TOKEN=admin-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.poster.PosterRepositoryIT$Recorder"
})
@AutoConfigureMockMvc
// 이 클래스만 쓰는 설정이라 끝나면 닫는다(BlogEndpointIT 와 같은 까닭).
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class PosterRepositoryIT {

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
    PosterRepository posters;

    @Autowired
    PlatformTransactionManager transactionManager;

    @Autowired
    MockMvc mvc;

    @Autowired
    ObjectMapper mapper;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE app_posters");
        Recorder.STATEMENTS.get().clear();
    }

    // ---- 포트 메서드마다 결과 ----

    @Test
    @DisplayName("insert 는 넘긴 칸을 모두 적고 revision 1 로 시작한다. 플랫폼 순서를 지키고 시각은 마이크로초로 반올림되며, 돌려준 포스터는 저장된 행과 같다")
    void insertWritesEveryColumnAndReturnsTheStoredRow() {
        Instant at = now.plusNanos(123_456_789);
        Poster inserted = posters.insert(full("full", "ko"), at).orElseThrow();

        Instant rounded = now.plus(123_457, ChronoUnit.MICROS);
        assertThat(inserted.revision()).isEqualTo(1);
        assertThat(inserted.draft()).isEqualTo(new PosterDraft("full", false, 7,
                now.minusSeconds(3600).plus(2, ChronoUnit.MICROS), now.plus(1, ChronoUnit.DAYS),
                List.of("android", "ios"), "ko", "1.2.3", "once", "cloud_voice_off", false, "배지", "제목", "본문",
                "asset:mascot-reading", "asset:cloud-voice-sample", "열기", "url", "https://acttub.com/a", "각주",
                "#A1B2C3"));
        assertThat(inserted.createdAt()).isEqualTo(rounded);
        assertThat(inserted.updatedAt()).isEqualTo(rounded);
        assertThat(posters.find(inserted.id())).contains(inserted);
        assertThat(jdbc.queryForObject("SELECT array_to_string(platforms, '|') FROM app_posters", String.class))
                .isEqualTo("android|ios");
        assertThat(jdbc.queryForObject("SELECT created_at FROM app_posters", OffsetDateTime.class).toInstant())
                .isEqualTo(rounded);
    }

    @Test
    @DisplayName("insert 는 비운 칸을 NULL 로 적는다. 플랫폼이 하나여도 그대로다")
    void insertKeepsNullColumns() {
        Poster plain = posters.insert(draft("plain", null, List.of("ios")), now).orElseThrow();

        assertThat(plain.draft()).isEqualTo(draft("plain", null, List.of("ios")));
        assertThat(jdbc.queryForMap("""
                SELECT locale, starts_at, ends_at, min_app_version, badge, body, image, audio, cta_label, cta_target,
                       footnote, image_bg
                  FROM app_posters WHERE id=?
                """, plain.id())).allSatisfy((column, value) -> assertThat(value).as(column).isNull());
    }

    @Test
    @DisplayName("insert 는 같은 (slug, 언어) 가 있으면 비어 있다. 언어 없음끼리도 같은 것으로 본다. slug 가 같아도 언어가 다르면 넣는다")
    void insertWithATakenSlugAndLocaleIsEmpty() {
        Poster korean = posters.insert(draft("same", "ko"), now).orElseThrow();
        Poster none = posters.insert(draft("same", null), now).orElseThrow();

        assertThat(posters.insert(full("same", "ko"), now.plusSeconds(60))).isEmpty();
        assertThat(posters.insert(full("same", null), now.plusSeconds(60))).isEmpty();
        assertThat(posters.insert(draft("same", "en"), now)).isPresent();

        assertThat(posters.find(korean.id())).contains(korean);
        assertThat(posters.find(none.id())).contains(none);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM app_posters", Integer.class)).isEqualTo(3);
    }

    @Test
    @DisplayName("update 는 모든 칸과 updated_at 을 바꾸고 created_at 은 둔다. revision 은 bump 일 때만 하나 오른다. 자기 (slug, 언어) 는 그대로 써도 된다")
    void updateChangesEveryColumnAndBumpsRevisionOnRequest() {
        Poster before = posters.insert(draft("old", null), now.minusSeconds(60)).orElseThrow();
        Instant at = now.plusNanos(999_999);

        Poster changed = posters.update(before.id(), full("new", "en"), false, at).orElseThrow();
        assertThat(changed).isEqualTo(new Poster(before.id(), 1, new PosterDraft("new", false, 7,
                now.minusSeconds(3600).plus(2, ChronoUnit.MICROS), now.plus(1, ChronoUnit.DAYS),
                List.of("android", "ios"), "en", "1.2.3", "once", "cloud_voice_off", false, "배지", "제목", "본문",
                "asset:mascot-reading", "asset:cloud-voice-sample", "열기", "url", "https://acttub.com/a", "각주",
                "#A1B2C3"), now.minusSeconds(60), now.plus(1, ChronoUnit.MILLIS)));
        assertThat(posters.find(before.id())).contains(changed);

        Poster bumped = posters.update(before.id(), draft("new", "en"), true, now.plusSeconds(1)).orElseThrow();
        assertThat(bumped.revision()).isEqualTo(2);
        assertThat(bumped.draft()).isEqualTo(draft("new", "en"));
        assertThat(bumped.updatedAt()).isEqualTo(now.plusSeconds(1));
        assertThat(posters.update(before.id(), draft("new", "en"), true, now.plusSeconds(2)))
                .map(Poster::revision).contains(3);
        assertThat(posters.update(before.id(), draft("new", "en"), false, now.plusSeconds(3)))
                .map(Poster::revision).contains(3);
    }

    @Test
    @DisplayName("update 는 다른 포스터가 그 (slug, 언어) 를 쓰면 비어 있고 아무것도 바꾸지 않는다. 언어 없음끼리도 겹친다. 없는 id 도 비어 있다")
    void updateToAnotherPostersSlugAndLocaleOrAMissingIdIsEmpty() {
        Poster none = posters.insert(draft("taken", null), now).orElseThrow();
        Poster korean = posters.insert(draft("taken", "ko"), now).orElseThrow();
        Poster other = posters.insert(draft("other", "ko"), now).orElseThrow();

        assertThat(posters.update(other.id(), draft("taken", "ko"), true, now.plusSeconds(60))).isEmpty();
        assertThat(posters.update(other.id(), draft("taken", null), true, now.plusSeconds(60))).isEmpty();
        assertThat(posters.update(korean.id(), draft("taken", null), true, now.plusSeconds(60))).isEmpty();
        assertThat(posters.update(UUID.randomUUID(), draft("fresh", null), true, now)).isEmpty();
        assertThat(posters.update(other.id(), draft("taken", "en"), false, now.plusSeconds(60)))
                .map(poster -> poster.draft().locale()).contains("en");

        assertThat(posters.find(none.id())).contains(none);
        assertThat(posters.find(korean.id())).contains(korean);
        assertThat(jdbc.queryForObject("SELECT revision FROM app_posters WHERE id=?", Integer.class, other.id()))
                .isEqualTo(1);
    }

    @Test
    @DisplayName("live 는 켜진 것 가운데 시작 ≤ now < 끝, 플랫폼이 맞고 언어가 없거나 같은 것을 우선순위·고친 시각 큰 것부터(같으면 id 작은 것부터) 낸다. 언어가 null 이면 언어 없는 것만이다")
    void liveFiltersByPeriodPlatformAndLocaleAndOrders() {
        row(id(1), "low", null, true, 1, null, null, "{ios,android}", now, now);
        row(id(3), "tie-high", null, true, 5, null, null, "{ios}", now, now);
        row(id(2), "tie-low", "ko", true, 5, now, now.plusSeconds(1), "{android,ios}", now, now);
        row(id(4), "newer", null, true, 5, null, null, "{ios}", now, now.plusSeconds(1));
        row(id(5), "off", null, false, 9, null, null, "{ios}", now, now);
        row(id(6), "not-yet", null, true, 9, now.plusSeconds(1), null, "{ios}", now, now);
        row(id(7), "ended", null, true, 9, null, now, "{ios}", now, now);
        row(id(8), "android-only", null, true, 9, null, null, "{android}", now, now);
        row(id(9), "english", "en", true, 9, null, null, "{ios}", now, now);

        assertThat(posters.live("ios", "ko", now)).extracting(Poster::id)
                .containsExactly(id(4), id(2), id(3), id(1));
        assertThat(posters.live("ios", null, now)).extracting(Poster::id).containsExactly(id(4), id(3), id(1));
        assertThat(posters.live("android", "ko", now)).extracting(Poster::id).containsExactly(id(8), id(2), id(1));
        assertThat(posters.live("ios", "ko", now).get(1)).isEqualTo(stored(id(2), "tie-low", "ko", true, 5, now,
                now.plusSeconds(1), List.of("android", "ios"), now, now));
    }

    @Test
    @DisplayName("history 는 시작 전인 것만 빼고(꺼진 것·끝난 것 포함) 플랫폼·언어가 맞는 것을 시작 시각(없으면 만든 시각) 늦은 것부터(같으면 id 작은 것부터) limit 개 낸다")
    void historyKeepsEndedAndInactiveAndOrdersByStartOrCreation() {
        row(id(1), "started-early", null, true, 0, now.minusSeconds(300), null, "{ios}", now, now);
        row(id(3), "created-tie", null, false, 0, null, now.minusSeconds(1), "{ios}", now.minusSeconds(60), now);
        row(id(2), "started-tie", "ko", true, 0, now.minusSeconds(60), null, "{ios,android}", now, now);
        row(id(4), "starts-now", null, true, 0, now, null, "{ios}", now.minusSeconds(900), now);
        row(id(5), "not-yet", null, true, 0, now.plusSeconds(1), null, "{ios}", now, now);
        row(id(6), "android-only", null, true, 0, null, null, "{android}", now, now);
        row(id(7), "english", "en", true, 0, null, null, "{ios}", now, now);

        assertThat(posters.history("ios", "ko", now, 50)).extracting(Poster::id)
                .containsExactly(id(4), id(2), id(3), id(1));
        assertThat(posters.history("ios", "ko", now, 2)).extracting(Poster::id).containsExactly(id(4), id(2));
        assertThat(posters.history("ios", null, now, 50)).extracting(Poster::id).containsExactly(id(4), id(3), id(1));
        assertThat(posters.history("android", "ko", now, 50)).extracting(Poster::id).containsExactly(id(6), id(2));
        assertThat(posters.history("ios", null, now, 50).get(1)).isEqualTo(stored(id(3), "created-tie", null, false,
                0, null, now.minusSeconds(1), List.of("ios"), now.minusSeconds(60), now));
    }

    @Test
    @DisplayName("all 은 꺼진 것까지 켜진 것, 우선순위 큰 것, 고친 시각 늦은 것 순(같으면 id 작은 것부터)으로 낸다")
    void allOrdersByActivePriorityUpdatedAtThenId() {
        row(id(1), "off-high", null, false, 9, null, null, "{ios}", now, now);
        row(id(3), "on-tie-high", null, true, 1, null, null, "{ios}", now, now);
        row(id(2), "on-tie-low", "ko", true, 1, null, null, "{android}", now, now);
        row(id(4), "on-newer", null, true, 1, null, null, "{ios}", now, now.plusSeconds(1));
        row(id(5), "on-top", null, true, 2, null, null, "{ios}", now, now.minusSeconds(60));

        assertThat(posters.all()).extracting(Poster::id).containsExactly(id(5), id(4), id(2), id(3), id(1));
    }

    @Test
    @DisplayName("find 는 꺼진 것도 id 로 찾고 없는 id 는 비어 있다")
    void findReadsInactivePosters() {
        row(id(1), "off", null, false, 0, null, null, "{android,ios}", now, now);

        assertThat(posters.find(id(1))).contains(stored(id(1), "off", null, false, 0, null, null,
                List.of("android", "ios"), now, now));
        assertThat(posters.find(UUID.randomUUID())).isEmpty();
    }

    // ---- 잠금 ----

    @Test
    @DisplayName("update 의 잠금은 slug·언어를 바꿔도 FOR NO KEY UPDATE 세기다 — 표현식 유니크 인덱스는 키가 아니라 바깥 FOR KEY SHARE 를 지나고, FOR SHARE 뒤에서는 기다린다")
    void updateLocksLikeAnUpdateOfANonKeyColumn() throws Exception {
        row(id(1), "locked", null, true, 0, null, null, "{ios}", now, now);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            lock(probe, id(1), "FOR KEY SHARE");
            assertThat(pool.submit(() -> posters.update(id(1), draft("renamed", "ko"), true, now))
                    .get(20, TimeUnit.SECONDS)).as("FOR KEY SHARE 와는 겹치지 않는다").isPresent();
            probe.rollback();

            lock(probe, id(1), "FOR SHARE");
            Future<Optional<Poster>> blocked = pool.submit(() ->
                    posters.update(id(1), draft("again", null), true, now));
            String waiting = awaitStatementWaitingOn("app_posters");
            probe.rollback();

            assertThat(waiting.toLowerCase(Locale.ROOT)).contains("update app_posters");
            assertThat(blocked.get(20, TimeUnit.SECONDS)).map(Poster::revision).contains(3);
        } finally {
            pool.shutdownNow();
        }
    }

    // ---- 경합 ----

    @Test
    @DisplayName("같은 (slug, 언어) 를 두 요청이 함께 넣으면 뒤의 INSERT 가 앞의 커밋을 기다렸다가 0행이 되어 422 duplicate_poster 를 받는다")
    void twoCreatesWithTheSameSlugAndLocaleTheLaterGets422() throws Exception {
        Race<Optional<Poster>> first = new Race<>(() -> posters.insert(draft("race", "ko"), now));
        try {
            Future<MockHttpServletResponse> second = first.pool.submit(() ->
                    admin(post("/v2/admin/posters"), "{\"slug\":\"race\",\"title\":\"뒤\",\"locale\":\"ko\"}"));
            assertThat(awaitStatementWaitingOn("app_posters").toLowerCase(Locale.ROOT)).contains("insert into app_posters");
            first.commit();

            assertThat(first.result()).isPresent();
            MockHttpServletResponse response = second.get(20, TimeUnit.SECONDS);
            assertThat(response.getStatus()).isEqualTo(422);
            assertThat(mapper.readTree(response.getContentAsString()).path("detail").stringValue(null))
                    .isEqualTo("duplicate_poster");
        } finally {
            first.pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT title FROM app_posters", String.class)).containsExactly("제목");
    }

    @Test
    @DisplayName("언어 없는 같은 slug 를 두 포트 호출이 함께 넣으면 뒤의 것은 비어 있다. 앞의 것이 되돌리면 뒤의 것이 넣는다")
    void twoInsertsWithTheSameSlugAndNoLocaleAtThePort() throws Exception {
        Race<Optional<Poster>> committed = new Race<>(() -> posters.insert(draft("race", null), now));
        try {
            Future<Optional<Poster>> later = committed.pool.submit(() -> posters.insert(full("race", null), now));
            awaitStatementWaitingOn("app_posters");
            committed.commit();
            assertThat(later.get(20, TimeUnit.SECONDS)).isEmpty();
        } finally {
            committed.pool.shutdownNow();
        }

        Race<Optional<Poster>> rolledBack = new Race<>(() -> posters.insert(draft("undo", null), now));
        try {
            Future<Optional<Poster>> later = rolledBack.pool.submit(() -> posters.insert(full("undo", null), now));
            awaitStatementWaitingOn("app_posters");
            rolledBack.rollback();
            assertThat(later.get(20, TimeUnit.SECONDS)).map(poster -> poster.draft().priority()).contains(7);
        } finally {
            rolledBack.pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT slug || ':' || priority FROM app_posters ORDER BY slug", String.class))
                .containsExactly("race:0", "undo:7");
    }

    @Test
    @DisplayName("두 포스터를 함께 같은 (slug, 언어) 로 바꾸면 둘 다 NOT EXISTS 를 지나고, 뒤의 것은 유니크 인덱스에서 앞의 커밋을 기다렸다가 422 duplicate_poster 를 받는다")
    void twoUpdatesToTheSameSlugAndLocaleTheLaterGets422() throws Exception {
        row(id(1), "one", "ko", true, 0, null, null, "{ios}", now, now);
        row(id(2), "two", "ko", true, 0, null, null, "{ios}", now, now);
        Race<Optional<Poster>> first = new Race<>(() -> posters.update(id(1), draft("taken", "ko"), false, now));
        try {
            Future<MockHttpServletResponse> second = first.pool.submit(() ->
                    admin(patch("/v2/admin/posters/" + id(2)), "{\"slug\":\"taken\"}"));
            assertThat(awaitStatementWaitingOn("app_posters").toLowerCase(Locale.ROOT)).contains("update app_posters");
            first.commit();

            assertThat(first.result()).map(poster -> poster.draft().slug()).contains("taken");
            MockHttpServletResponse response = second.get(20, TimeUnit.SECONDS);
            assertThat(response.getStatus()).isEqualTo(422);
            assertThat(mapper.readTree(response.getContentAsString()).path("detail").stringValue(null))
                    .isEqualTo("duplicate_poster");
        } finally {
            first.pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT slug FROM app_posters ORDER BY id", String.class))
                .containsExactly("taken", "two");
    }

    @Test
    @DisplayName("두 포트 호출이 함께 언어 없는 같은 slug 로 바꾸면 뒤의 것은 uq_app_posters_slug_locale 위반을 받아 비어 있다. 앞의 것이 되돌리면 뒤의 것이 바꾼다")
    void twoUpdatesToTheSameSlugAndNoLocaleAtThePort() throws Exception {
        row(id(1), "one", null, true, 0, null, null, "{ios}", now, now);
        row(id(2), "two", null, true, 0, null, null, "{ios}", now, now);
        Race<Optional<Poster>> committed = new Race<>(() ->
                posters.update(id(1), draft("taken", null), false, now));
        try {
            Future<Optional<Poster>> later = committed.pool.submit(() ->
                    posters.update(id(2), draft("taken", null), false, now));
            awaitStatementWaitingOn("app_posters");
            committed.commit();

            assertThat(later.get(20, TimeUnit.SECONDS)).isEmpty();
        } finally {
            committed.pool.shutdownNow();
        }

        Race<Optional<Poster>> rolledBack = new Race<>(() ->
                posters.update(id(1), draft("again", null), false, now));
        try {
            Future<Optional<Poster>> later = rolledBack.pool.submit(() ->
                    posters.update(id(2), draft("again", null), false, now));
            awaitStatementWaitingOn("app_posters");
            rolledBack.rollback();
            assertThat(later.get(20, TimeUnit.SECONDS)).map(poster -> poster.draft().slug()).contains("again");
        } finally {
            rolledBack.pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT slug FROM app_posters ORDER BY id", String.class))
                .containsExactly("taken", "again");
    }

    @Test
    @DisplayName("같은 포스터의 revision 을 두 요청이 함께 올리면 뒤의 것이 앞의 커밋을 기다렸다가 그 값에 하나 더한다 — 하나가 사라지지 않는다")
    void twoBumpsOfTheSamePosterBothCount() throws Exception {
        row(id(1), "bump", null, true, 0, null, null, "{ios}", now, now);
        Race<Optional<Poster>> first = new Race<>(() -> posters.update(id(1), draft("bump", null), true, now));
        try {
            Future<Optional<Poster>> second = first.pool.submit(() ->
                    posters.update(id(1), draft("bump", null), true, now.plusSeconds(1)));
            assertThat(awaitStatementWaitingOn("app_posters").toLowerCase(Locale.ROOT)).contains("update app_posters");
            first.commit();

            assertThat(first.result()).map(Poster::revision).contains(2);
            assertThat(second.get(20, TimeUnit.SECONDS)).map(Poster::revision).contains(3);
        } finally {
            first.pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT revision FROM app_posters", Integer.class)).isEqualTo(3);
    }

    // ---- 문장 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류. 넣기·고치기는 한 문장으로 쓰고, 쓴 행이 있으면 같은 트랜잭션에서 id 로 다시 읽는다")
    void eachPortMethodSendsTheseStatements() {
        assertThat(statementsOf(() -> posters.insert(draft("counted", "ko"), now)))
                .as("RETURNING 대신 같은 트랜잭션에서 id 로 다시 읽는다")
                .containsExactly("insert app_posters on conflict", "select app_posters");
        assertThat(statementsOf(() -> posters.insert(draft("counted", "ko"), now)))
                .as("같은 (slug, 언어) 가 있으면 0행이라 다시 읽지 않는다")
                .containsExactly("insert app_posters on conflict");
        UUID id = jdbc.queryForObject("SELECT id FROM app_posters", UUID.class);
        row(id(9), "other", "ko", true, 0, null, null, "{ios}", now, now);

        assertThat(statementsOf(() -> posters.update(id, draft("counted", "ko"), true, now)))
                .as("조건부 갱신은 한 문장 그대로이고 RETURNING 대신 다시 읽는다")
                .containsExactly("update app_posters not exists", "select app_posters");
        assertThat(statementsOf(() -> posters.update(id, draft("other", "ko"), true, now)))
                .as("다른 포스터가 그 (slug, 언어) 를 쓰면 0행이라 다시 읽지 않는다")
                .containsExactly("update app_posters not exists");
        assertThat(statementsOf(() -> posters.live("ios", "ko", now))).containsExactly("select app_posters");
        assertThat(statementsOf(() -> posters.live("ios", null, now))).containsExactly("select app_posters");
        assertThat(statementsOf(() -> posters.history("ios", "ko", now, 50))).containsExactly("select app_posters");
        assertThat(statementsOf(() -> posters.all())).containsExactly("select app_posters");
        assertThat(statementsOf(() -> posters.find(id))).containsExactly("select app_posters");
    }

    // ---- 도움 ----

    private static final Pattern SELECT = Pattern.compile("^select .*? from (\\w+)\\b.*");
    private static final Pattern INSERT = Pattern.compile("^insert into (\\w+)\\b.*");
    private static final Pattern UPDATE = Pattern.compile("^update (\\w+)\\b.*");

    /**
     * 문장을 "<종류> <표>[ 덧붙임]" 으로 줄인다. 별칭·열 목록·매개변수 표기는 두 구현이 달라 견주지 않는다. 데이터를 바꾸는
     * CTE({@code WITH x AS (INSERT … RETURNING *) SELECT …})는 안쪽 문장으로 본다.
     */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT).replaceFirst("^with \\w+ as \\( ?", "");
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
        List<String> sent = Recorder.STATEMENTS.get().stream().map(PosterRepositoryIT::label).toList();
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

    private MockHttpServletResponse admin(MockHttpServletRequestBuilder request, String body) throws Exception {
        return mvc.perform(request.header("Authorization", ADMIN).contentType(MediaType.APPLICATION_JSON).content(body))
                .andReturn().getResponse();
    }

    /** 기본값만 쓴 포스터. */
    private static PosterDraft draft(String slug, String locale) {
        return draft(slug, locale, List.of("ios", "android"));
    }

    private static PosterDraft draft(String slug, String locale, List<String> platforms) {
        return new PosterDraft(slug, true, 0, null, null, platforms, locale, null, "daily", "all", true, null, "제목",
                null, null, null, null, "none", null, null, null);
    }

    /** 모든 칸을 채운 포스터. */
    private PosterDraft full(String slug, String locale) {
        return new PosterDraft(slug, false, 7, now.minusSeconds(3600).plusNanos(1_500), now.plus(1, ChronoUnit.DAYS),
                List.of("android", "ios"), locale, "1.2.3", "once", "cloud_voice_off", false, "배지", "제목", "본문",
                "asset:mascot-reading", "asset:cloud-voice-sample", "열기", "url", "https://acttub.com/a", "각주",
                "#A1B2C3");
    }

    private void row(UUID id, String slug, String locale, boolean active, int priority, Instant startsAt, Instant endsAt,
            String platforms, Instant createdAt, Instant updatedAt) {
        jdbc.update("""
                INSERT INTO app_posters(id,slug,locale,active,priority,starts_at,ends_at,platforms,title,created_at,updated_at)
                VALUES (?,?,?,?,?,?,?,?::text[],'제목',?,?)
                """, id, slug, locale, active, priority, utc(startsAt), utc(endsAt), platforms, utc(createdAt),
                utc(updatedAt));
    }

    /** {@link #row} 로 넣은 행을 포트가 낼 때의 값. */
    private static Poster stored(UUID id, String slug, String locale, boolean active, int priority, Instant startsAt,
            Instant endsAt, List<String> platforms, Instant createdAt, Instant updatedAt) {
        return new Poster(id, 1, new PosterDraft(slug, active, priority, startsAt, endsAt, platforms, locale, null,
                "daily", "all", true, null, "제목", null, null, null, null, "none", null, null, null), createdAt, updatedAt);
    }

    private static OffsetDateTime utc(Instant value) {
        return value == null ? null : value.atOffset(ZoneOffset.UTC);
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
        try (PreparedStatement statement = probe.prepareStatement("SELECT 1 FROM app_posters WHERE id=? " + strength)) {
            statement.setObject(1, id);
            statement.execute();
        }
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
