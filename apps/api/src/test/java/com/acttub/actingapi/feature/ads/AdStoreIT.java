package com.acttub.actingapi.feature.ads;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.TreeSet;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.ads.app.AdFrequency;
import com.acttub.actingapi.feature.ads.app.AdFrequency.Limits;
import com.acttub.actingapi.feature.ads.app.AdRepository;
import com.acttub.actingapi.feature.ads.app.AdSlotSwitches;
import com.acttub.actingapi.feature.ads.domain.Ad;
import com.acttub.actingapi.feature.ads.domain.AdDraft;
import com.acttub.actingapi.feature.ads.domain.AdStats;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 광고 저장소 셋(광고·노출과 클릭, 빈도 상한, 칸 스위치)의 문장이 내는 결과·잠금·경합·문장 수를 실제 PostgreSQL 에서 고정한다.
 * 네이티브 SQL 을 JPA 로 옮기기 전에 네이티브 구현에서 먼저 통과시킨다(apps/api/CONTRACT.md §5-9).
 *
 * <p>HTTP 쪽 고르는 순서·빈도 상한의 판정·운영 화면의 값 검사는 {@link AdEndpointIT}·{@link AdAdminEndpointIT} 가 본다. 여기서는
 * 그 테스트가 밟지 않는 모든 칸, 칸 배열의 순서, 기간과 시각의 경계, 같은 값의 정렬, 50개 자르기, 노출의 날짜별 한 번,
 * 같은 노출을 두 요청이 함께 남길 때, 포트 메서드마다 나가는 문장을 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.ads.AdStoreIT$Recorder"
})
// 이 클래스만 쓰는 설정이라 끝나면 닫는다(PosterRepositoryIT 와 같은 까닭).
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class AdStoreIT {

    /** 이 스레드가 보낸 SQL 을 모은다. 경합 쪽 스레드의 문장은 섞이지 않는다. */
    public static class Recorder implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    @Value("${spring.datasource.url}")
    private String databaseUrl;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    AdRepository ads;

    @Autowired
    AdFrequency frequency;

    @Autowired
    AdSlotSwitches switches;

    @Autowired
    PlatformTransactionManager transactionManager;

    private final Instant now = Instant.parse("2026-11-27T03:00:00Z");
    private final LocalDate today = LocalDate.parse("2026-11-27");
    private UUID user;
    private UUID other;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users, ads, ad_serves, ad_slot_switches CASCADE");
        jdbc.update("INSERT INTO ad_settings(id) VALUES (1) ON CONFLICT (id) DO NOTHING");
        jdbc.update("UPDATE ad_settings SET window_minutes=10, window_cap=5, first_day_cap=3");
        user = UUID.randomUUID();
        other = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active'), (?,'active')", user, other);
        Recorder.STATEMENTS.get().clear();
    }

    // ---- 빈도 상한(ad_settings·ad_serves) ----

    @Test
    @DisplayName("limits 는 설정 줄을 읽고, 줄이 없으면 10분 5개·첫날 3개를 낸다")
    void limitsReadsTheSettingsRowOrDefaults() {
        jdbc.update("UPDATE ad_settings SET window_minutes=30, window_cap=7, first_day_cap=2");
        assertThat(frequency.limits()).isEqualTo(new Limits(30, 7, 2));

        jdbc.update("DELETE FROM ad_settings");
        assertThat(frequency.limits()).isEqualTo(new Limits(10, 5, 3));
    }

    @Test
    @DisplayName("update 는 줄이 있으면 세 숫자와 고친 시각을 바꾸고, 없으면 id 1 로 넣는다. 돌려준 값은 다시 읽은 값이다")
    void updateUpsertsTheSingleRow() {
        Instant at = now.plusNanos(123_456_789);
        assertThat(frequency.update(new Limits(60, 9, 4), at)).isEqualTo(new Limits(60, 9, 4));
        assertThat(jdbc.queryForObject("SELECT updated_at FROM ad_settings WHERE id=1", OffsetDateTime.class).toInstant())
                .isEqualTo(now.plus(123_457, ChronoUnit.MICROS));

        jdbc.update("DELETE FROM ad_settings");
        assertThat(frequency.update(new Limits(1, 0, 100), now)).isEqualTo(new Limits(1, 0, 100));
        assertThat(jdbc.queryForList("SELECT id || ':' || window_minutes || ':' || window_cap || ':' || first_day_cap FROM ad_settings",
                String.class)).containsExactly("1:1:0:100");
    }

    @Test
    @DisplayName("servedSince 는 since 보다 늦게 이 사람에게 내보낸 수만 센다 — since 와 같은 시각은 세지 않는다")
    void servedSinceCountsStrictlyLaterServesOfThatUser() {
        serve(user, now.minusSeconds(600));
        serve(user, now.minusSeconds(300));
        serve(user, now.minusSeconds(299));
        serve(user, now);
        serve(other, now);

        assertThat(frequency.servedSince(user, now.minusSeconds(300))).isEqualTo(2);
        assertThat(frequency.servedSince(user, now.minusSeconds(601))).isEqualTo(4);
        assertThat(frequency.servedSince(user, now)).isZero();
        assertThat(frequency.servedSince(UUID.randomUUID(), now.minusSeconds(3600))).isZero();
    }

    @Test
    @DisplayName("recordServe 는 부를 때마다 한 줄을 넣고 시각은 마이크로초로 반올림된다")
    void recordServeInsertsARowEachTime() {
        frequency.recordServe(user, now.plusNanos(1_500));
        frequency.recordServe(user, now.plusNanos(1_500));

        assertThat(jdbc.queryForList("SELECT served_at FROM ad_serves WHERE user_id=?", OffsetDateTime.class, user))
                .extracting(OffsetDateTime::toInstant)
                .containsExactly(now.plus(2, ChronoUnit.MICROS), now.plus(2, ChronoUnit.MICROS));
        assertThat(jdbc.queryForObject("SELECT count(DISTINCT id) FROM ad_serves", Integer.class)).isEqualTo(2);
    }

    @Test
    @DisplayName("purgeBefore 는 before 보다 이른 기록만 지우고 지운 수를 낸다 — 같은 시각은 남긴다")
    void purgeBeforeDeletesStrictlyEarlierServes() {
        serve(user, now.minusSeconds(1));
        serve(other, now.minusSeconds(2));
        serve(user, now);
        serve(user, now.plusSeconds(1));

        assertThat(frequency.purgeBefore(now)).isEqualTo(2);
        assertThat(frequency.purgeBefore(now)).isZero();
        assertThat(jdbc.queryForList("SELECT served_at FROM ad_serves ORDER BY served_at", OffsetDateTime.class))
                .extracting(OffsetDateTime::toInstant).containsExactly(now, now.plusSeconds(1));
    }

    // ---- 칸 스위치(ad_slot_switches) ----

    @Test
    @DisplayName("off 는 enabled=false 줄이 있을 때만, switchedOn 은 enabled=true 줄이 있을 때만 참이다. 줄이 없으면 둘 다 거짓이다")
    void slotSwitchesReadTheRow() {
        assertThat(switches.off("home_top")).isFalse();
        assertThat(switches.switchedOn("home_top")).isFalse();

        jdbc.update("INSERT INTO ad_slot_switches(slot_key, enabled) VALUES ('home_top', false), ('profile_top', true)");
        assertThat(switches.off("home_top")).isTrue();
        assertThat(switches.switchedOn("home_top")).isFalse();
        assertThat(switches.off("profile_top")).isFalse();
        assertThat(switches.switchedOn("profile_top")).isTrue();
        assertThat(switches.off("settings_top")).isFalse();
        assertThat(switches.switchedOn("settings_top")).isFalse();
    }

    // ---- 광고(ads) ----

    @Test
    @DisplayName("activeFor 는 켜진 직접·자체 광고 가운데 그 칸을 가지고 시작 ≤ now < 끝인 것을 우선순위 큰 것부터(같으면 id 작은 것부터) 낸다")
    void activeForFiltersAndOrders() {
        ad(id(1), "direct", "active", "{home_top,profile_top}", 1, null, null, now);
        ad(id(3), "house", "active", "{home_top}", 5, now, now.plusSeconds(1), now);
        ad(id(2), "direct", "active", "{profile_top,home_top}", 5, null, null, now);
        ad(id(4), "direct", "paused", "{home_top}", 9, null, null, now);
        ad(id(5), "direct", "ended", "{home_top}", 9, null, null, now);
        ad(id(6), "direct", "active", "{home_top}", 9, now.plusSeconds(1), null, now);
        ad(id(7), "direct", "active", "{home_top}", 9, null, now, now);
        ad(id(8), "direct", "active", "{profile_top}", 9, null, null, now);
        ad(id(9), "network", "active", "{home_top}", 9, null, null, now);
        ad(id(10), "direct", "active", "{}", 9, null, null, now);

        assertThat(ads.activeFor("home_top", now)).extracting(Ad::id).containsExactly(id(2), id(3), id(1));
        assertThat(ads.activeFor("profile_top", now)).extracting(Ad::id).containsExactly(id(8), id(2), id(1));
        assertThat(ads.activeFor("settings_top", now)).isEmpty();
        assertThat(ads.activeFor("home_top", now).getFirst()).isEqualTo(new Ad(id(2), "direct",
                List.of("profile_top", "home_top"), "all", 5, "광고주", null, null, null, null, null,
                "https://example.com", null, 50));
    }

    @Test
    @DisplayName("activeFor 는 50개까지만 낸다")
    void activeForStopsAtFifty() {
        for (int n = 1; n <= 51; n++) {
            ad(id(n), "direct", "active", "{home_top}", n, null, null, now);
        }

        List<Ad> picked = ads.activeFor("home_top", now);
        assertThat(picked).hasSize(50);
        assertThat(picked.getFirst().id()).isEqualTo(id(51));
        assertThat(picked.getLast().id()).isEqualTo(id(2));
    }

    @Test
    @DisplayName("find 는 상태·기간과 상관없이 id 로 모든 칸을 읽는다. 칸이 비면 빈 목록이고 없는 id 는 비어 있다")
    void findReadsEveryColumn() {
        AdStats.Stored stored = ads.insert(full("ended"), now);

        assertThat(ads.find(stored.id())).contains(new Ad(stored.id(), "house", List.of("upload_wait", "home_top"),
                "pro", 7, "광고주", "제목", "본문", "https://example.com/l.png", "https://example.com/b.png",
                "https://example.com/m.png", "https://example.com/go", "/reading", 30));
        ad(id(1), "direct", "paused", "{}", 0, null, null, now);
        assertThat(ads.find(id(1))).map(Ad::slots).contains(List.of());
        assertThat(ads.find(UUID.randomUUID())).isEmpty();
    }

    @Test
    @DisplayName("insert 는 넘긴 칸을 모두 적고 두 시각을 now 로 둔다. 시각은 마이크로초로 반올림되고 칸 배열의 순서를 지킨다")
    void insertWritesEveryColumnAndReturnsTheStoredRow() {
        Instant at = now.plusNanos(123_456_789);
        AdStats.Stored stored = ads.insert(full("active"), at);

        Instant rounded = now.plus(123_457, ChronoUnit.MICROS);
        assertThat(stored).isEqualTo(new AdStats.Stored(stored.id(), roundedFull("active"), rounded, rounded, 0, 0));
        assertThat(ads.findStored(stored.id())).contains(stored);
        assertThat(jdbc.queryForObject("SELECT array_to_string(slots, '|') FROM ads", String.class))
                .isEqualTo("upload_wait|home_top");
    }

    @Test
    @DisplayName("insert 는 비운 칸을 NULL 로 적고 칸이 없으면 빈 배열이다")
    void insertKeepsNullColumns() {
        AdStats.Stored stored = ads.insert(new AdDraft("direct", "paused", List.of(), "all", 0, null, null, null, null,
                null, null, null, null, null, null, 0), now);

        assertThat(stored.draft()).isEqualTo(new AdDraft("direct", "paused", List.of(), "all", 0, null, null, null,
                null, null, null, null, null, null, null, 0));
        assertThat(jdbc.queryForObject("SELECT cardinality(slots) FROM ads", Integer.class)).isZero();
        assertThat(jdbc.queryForMap("""
                SELECT advertiser_name, headline, body, image_large_banner, image_banner, image_medium_rectangle,
                       link_url, app_path, starts_at, ends_at
                  FROM ads WHERE id=?
                """, stored.id())).allSatisfy((column, value) -> assertThat(value).as(column).isNull());
    }

    @Test
    @DisplayName("update 는 모든 칸과 updated_at 을 바꾸고 created_at 과 합계는 둔다. 없는 id 는 비어 있다")
    void updateChangesEveryColumn() {
        AdStats.Stored before = ads.insert(new AdDraft("direct", "active", List.of("home_top"), "all", 0, "옛 광고주",
                null, null, null, "https://example.com/old.png", null, "https://example.com", null, null, null, 100),
                now.minusSeconds(60));
        event(before.id(), user, "impression", today);
        event(before.id(), user, "click", today);

        Optional<AdStats.Stored> changed = ads.update(before.id(), full("paused"), now.plusNanos(999_999));
        assertThat(changed).contains(new AdStats.Stored(before.id(), roundedFull("paused"), now.minusSeconds(60),
                now.plus(1, ChronoUnit.MILLIS), 1, 1));
        assertThat(ads.findStored(before.id())).isEqualTo(changed);

        assertThat(ads.update(UUID.randomUUID(), full("active"), now)).isEmpty();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM ads", Integer.class)).isEqualTo(1);
    }

    @Test
    @DisplayName("all 은 꺼진 것까지 켜진 것, 우선순위 큰 것, 만든 시각 늦은 것 순(같으면 id 작은 것부터)으로 노출·클릭 합계와 함께 낸다")
    void allOrdersByActivePriorityCreatedAtThenId() {
        ad(id(1), "direct", "paused", "{home_top}", 9, null, null, now);
        ad(id(3), "direct", "active", "{home_top}", 1, null, null, now);
        ad(id(2), "house", "active", "{home_top}", 1, null, null, now);
        ad(id(4), "direct", "active", "{home_top}", 1, null, null, now.plusSeconds(1));
        ad(id(5), "direct", "active", "{home_top}", 2, null, null, now.minusSeconds(60));
        ad(id(6), "direct", "ended", "{home_top}", 9, null, null, now.plusSeconds(60));
        event(id(3), user, "impression", today);
        event(id(3), other, "impression", today);
        event(id(3), user, "impression", today.minusDays(1));
        event(id(3), user, "click", today);
        event(id(1), user, "click", today);

        List<AdStats.Stored> all = ads.all();
        assertThat(all).extracting(AdStats.Stored::id).containsExactly(id(5), id(4), id(2), id(3), id(6), id(1));
        assertThat(all).extracting(stored -> stored.impressions() + ":" + stored.clicks())
                .containsExactly("0:0", "0:0", "0:0", "3:1", "0:0", "0:1");
        assertThat(ads.findStored(id(3))).map(stored -> stored.impressions() + ":" + stored.clicks()).contains("3:1");
        assertThat(ads.findStored(UUID.randomUUID())).isEmpty();
    }

    // ---- 노출·클릭(ad_events) ----

    @Test
    @DisplayName("recordImpression 은 한 사람·광고·날짜에 한 번만 남긴다. 다른 날·다른 사람·다른 광고는 새로 남기고, 클릭은 세지 않는다")
    void recordImpressionOncePerPersonAdAndDay() {
        ad(id(1), "direct", "active", "{home_top}", 0, null, null, now);
        ad(id(2), "direct", "active", "{home_top}", 0, null, null, now);
        ads.recordClick(id(1), user, "home_top", today, now);

        assertThat(ads.recordImpression(id(1), user, "home_top", today, now.plusNanos(1_500))).isTrue();
        assertThat(ads.recordImpression(id(1), user, "profile_top", today, now.plusSeconds(60))).isFalse();
        assertThat(ads.recordImpression(id(1), user, "home_top", today.plusDays(1), now)).isTrue();
        assertThat(ads.recordImpression(id(1), other, "home_top", today, now)).isTrue();
        assertThat(ads.recordImpression(id(2), user, "home_top", today, now)).isTrue();

        assertThat(jdbc.queryForList("""
                SELECT slot || ':' || event || ':' || day || ':' || to_char(created_at AT TIME ZONE 'UTC', 'HH24:MI:SS.US')
                  FROM ad_events WHERE ad_id=? AND user_id=? ORDER BY day, event
                """, String.class, id(1), user))
                .containsExactly("home_top:click:2026-11-27:03:00:00.000000",
                        "home_top:impression:2026-11-27:03:00:00.000002",
                        "home_top:impression:2026-11-28:03:00:00.000000");
    }

    @Test
    @DisplayName("recordClick 은 누를 때마다 한 줄을 넣는다")
    void recordClickInsertsEachTime() {
        ad(id(1), "direct", "active", "{home_top}", 0, null, null, now);
        ads.recordClick(id(1), user, "home_top", today, now);
        ads.recordClick(id(1), user, "home_top", today, now);
        ads.recordImpression(id(1), user, "home_top", today, now);
        ads.recordClick(id(1), user, "profile_top", today, now);

        assertThat(jdbc.queryForList("SELECT slot FROM ad_events WHERE event='click' ORDER BY slot", String.class))
                .containsExactly("home_top", "home_top", "profile_top");
    }

    @Test
    @DisplayName("dailyEvents 는 from~to(양 끝 포함)의 그 광고 기록을 날짜별 노출·클릭으로 날짜 순에 낸다. 기록이 없는 날은 없다")
    void dailyEventsGroupsByDayWithinInclusiveRange() {
        ad(id(1), "direct", "active", "{home_top}", 0, null, null, now);
        ad(id(2), "direct", "active", "{home_top}", 0, null, null, now);
        event(id(1), user, "impression", today.minusDays(3));
        event(id(1), user, "impression", today.minusDays(2));
        event(id(1), other, "impression", today.minusDays(2));
        event(id(1), user, "click", today.minusDays(2));
        event(id(1), user, "click", today);
        event(id(1), user, "impression", today.plusDays(1));
        event(id(2), user, "impression", today);

        assertThat(ads.dailyEvents(id(1), today.minusDays(2), today)).containsExactly(
                new AdStats.Day(today.minusDays(2), 2, 1),
                new AdStats.Day(today, 0, 1));
        assertThat(ads.dailyEvents(id(1), today, today)).containsExactly(new AdStats.Day(today, 0, 1));
        assertThat(ads.dailyEvents(UUID.randomUUID(), today.minusDays(9), today)).isEmpty();
    }

    // ---- 잠금 ----

    @Test
    @DisplayName("update 의 잠금은 FOR NO KEY UPDATE 세기다 — 바깥 FOR KEY SHARE 를 지나고, FOR SHARE 뒤에서는 기다린다")
    void updateLocksLikeAnUpdateOfANonKeyColumn() throws Exception {
        ad(id(1), "direct", "active", "{home_top}", 0, null, null, now);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            lock(probe, id(1), "FOR KEY SHARE");
            assertThat(pool.submit(() -> ads.update(id(1), full("paused"), now)).get(20, TimeUnit.SECONDS))
                    .as("FOR KEY SHARE 와는 겹치지 않는다").isPresent();
            probe.rollback();

            lock(probe, id(1), "FOR SHARE");
            Future<Optional<AdStats.Stored>> blocked = pool.submit(() -> ads.update(id(1), full("active"), now));
            String waiting = awaitStatementWaitingOn("ads");
            probe.rollback();

            assertThat(waiting.toLowerCase(Locale.ROOT)).startsWith("update ads");
            assertThat(blocked.get(20, TimeUnit.SECONDS)).map(stored -> stored.draft().status()).contains("active");
        } finally {
            pool.shutdownNow();
        }
    }

    // ---- 경합 ----

    @Test
    @DisplayName("같은 노출을 두 요청이 함께 남기면 뒤의 것이 앞의 커밋을 기다렸다가 거짓을 받는다. 앞의 것이 되돌리면 뒤의 것이 남긴다")
    void twoImpressionsOfTheSameKeyTheLaterWaits() throws Exception {
        ad(id(1), "direct", "active", "{home_top}", 0, null, null, now);
        Race<Boolean> committed = new Race<>(() -> ads.recordImpression(id(1), user, "home_top", today, now));
        try {
            Future<Boolean> later = committed.pool.submit(() ->
                    ads.recordImpression(id(1), user, "profile_top", today, now));
            assertThat(awaitStatementWaitingOn("ad_events").toLowerCase(Locale.ROOT)).startsWith("insert into ad_events");
            committed.commit();

            assertThat(committed.result()).isTrue();
            assertThat(later.get(20, TimeUnit.SECONDS)).isFalse();
        } finally {
            committed.pool.shutdownNow();
        }

        Race<Boolean> rolledBack = new Race<>(() -> ads.recordImpression(id(1), other, "home_top", today, now));
        try {
            Future<Boolean> later = rolledBack.pool.submit(() ->
                    ads.recordImpression(id(1), other, "profile_top", today, now));
            awaitStatementWaitingOn("ad_events");
            rolledBack.rollback();
            assertThat(later.get(20, TimeUnit.SECONDS)).isTrue();
        } finally {
            rolledBack.pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT slot FROM ad_events ORDER BY user_id = ?, slot", String.class, other))
                .containsExactly("home_top", "profile_top");
    }

    @Test
    @DisplayName("빈도 설정을 두 요청이 함께 바꾸면 뒤의 것이 앞의 커밋을 기다렸다가 자기 값으로 덮는다")
    void twoSettingsUpdatesTheLaterWins() throws Exception {
        Race<Limits> first = new Race<>(() -> frequency.update(new Limits(20, 6, 2), now));
        try {
            Future<Limits> second = first.pool.submit(() -> frequency.update(new Limits(30, 8, 1), now.plusSeconds(1)));
            assertThat(awaitStatementWaitingOn("ad_settings").toLowerCase(Locale.ROOT)).startsWith("insert into ad_settings");
            first.commit();

            assertThat(first.result()).isEqualTo(new Limits(20, 6, 2));
            assertThat(second.get(20, TimeUnit.SECONDS)).isEqualTo(new Limits(30, 8, 1));
        } finally {
            first.pool.shutdownNow();
        }
        assertThat(frequency.limits()).isEqualTo(new Limits(30, 8, 1));
    }

    // ---- 문장 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류")
    void eachPortMethodSendsTheseStatements() {
        assertThat(statementsOf(() -> frequency.limits())).containsExactly("select ad_settings");
        assertThat(statementsOf(() -> frequency.update(new Limits(10, 5, 3), now)))
                .containsExactly("insert ad_settings on conflict", "select ad_settings");
        assertThat(statementsOf(() -> frequency.servedSince(user, now))).containsExactly("select ad_serves");
        assertThat(statementsOf(() -> {
            frequency.recordServe(user, now);
            return null;
        })).containsExactly("insert ad_serves");
        assertThat(statementsOf(() -> frequency.purgeBefore(now))).containsExactly("delete ad_serves");
        assertThat(statementsOf(() -> switches.off("home_top"))).containsExactly("select ad_slot_switches");
        assertThat(statementsOf(() -> switches.switchedOn("home_top"))).containsExactly("select ad_slot_switches");

        AdStats.Stored[] stored = new AdStats.Stored[1];
        assertThat(statementsOf(() -> stored[0] = ads.insert(full("active"), now)))
                .containsExactly("insert ads", "select ad_events ads");
        UUID id = stored[0].id();
        assertThat(statementsOf(() -> ads.update(id, full("paused"), now)))
                .containsExactly("update ads", "select ad_events ads");
        assertThat(statementsOf(() -> ads.update(UUID.randomUUID(), full("paused"), now))).containsExactly("update ads");
        assertThat(statementsOf(() -> ads.all())).containsExactly("select ad_events ads");
        assertThat(statementsOf(() -> ads.findStored(id))).containsExactly("select ad_events ads");
        assertThat(statementsOf(() -> ads.find(id))).containsExactly("select ads");
        assertThat(statementsOf(() -> ads.activeFor("home_top", now))).containsExactly("select ads");
        assertThat(statementsOf(() -> ads.recordImpression(id, user, "home_top", today, now)))
                .containsExactly("insert ad_events on conflict");
        assertThat(statementsOf(() -> {
            ads.recordClick(id, user, "home_top", today, now);
            return null;
        })).containsExactly("insert ad_events");
        assertThat(statementsOf(() -> ads.dailyEvents(id, today, today))).containsExactly("select ad_events");
        assertThat(statementsOf(() -> ads.practiced(user)))
                .containsExactly("select challenge_entries coach_conversations coach_notes practices reading_sessions");
    }

    // ---- 도움 ----

    private static final Pattern KIND = Pattern.compile("^(select|insert|update|delete)\\b.*");
    private static final Pattern TABLE = Pattern.compile("\\b(?:from|join|into|update) (?!set\\b)(\\w+)\\b");

    /**
     * 문장을 "<종류> <문장에 나오는 표(가나다 순)>[ on conflict]" 로 줄인다. 별칭·열 목록·매개변수 표기·하위 조회의 자리는 두
     * 구현이 달라 견주지 않는다.
     */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        Matcher kind = KIND.matcher(text);
        if (!kind.matches()) {
            return text;
        }
        TreeSet<String> tables = new TreeSet<>();
        Matcher table = TABLE.matcher(text);
        while (table.find()) {
            tables.add(table.group(1));
        }
        return kind.group(1) + " " + String.join(" ", tables) + (text.contains(" on conflict") ? " on conflict" : "");
    }

    private List<String> statementsOf(Supplier<?> call) {
        Recorder.STATEMENTS.get().clear();
        call.get();
        List<String> sent = Recorder.STATEMENTS.get().stream().map(AdStoreIT::label).toList();
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

    /** 모든 칸을 채운 자체 광고. */
    private AdDraft full(String status) {
        return new AdDraft("house", status, List.of("upload_wait", "home_top"), "pro", 7, "광고주", "제목", "본문",
                "https://example.com/l.png", "https://example.com/b.png", "https://example.com/m.png",
                "https://example.com/go", "/reading", now.minusSeconds(3600).plusNanos(1_500),
                now.plus(1, ChronoUnit.DAYS), 30);
    }

    /** {@link #full} 을 저장한 뒤 읽은 값 — 시작 시각이 마이크로초로 반올림된다. */
    private AdDraft roundedFull(String status) {
        return new AdDraft("house", status, List.of("upload_wait", "home_top"), "pro", 7, "광고주", "제목", "본문",
                "https://example.com/l.png", "https://example.com/b.png", "https://example.com/m.png",
                "https://example.com/go", "/reading", now.minusSeconds(3600).plus(2, ChronoUnit.MICROS),
                now.plus(1, ChronoUnit.DAYS), 30);
    }

    private void ad(UUID id, String kind, String status, String slots, int priority, Instant startsAt, Instant endsAt,
            Instant createdAt) {
        jdbc.update("""
                INSERT INTO ads(id,kind,status,slots,priority,advertiser_name,link_url,starts_at,ends_at,created_at,updated_at)
                VALUES (?,?,?,?::text[],?,'광고주','https://example.com',?,?,?,?)
                """, id, kind, status, slots, priority, utc(startsAt), utc(endsAt), utc(createdAt), utc(createdAt));
    }

    private void event(UUID adId, UUID userId, String event, LocalDate day) {
        jdbc.update("INSERT INTO ad_events(id,ad_id,user_id,slot,event,day) VALUES (?,?,?,'home_top',?,?)",
                UUID.randomUUID(), adId, userId, event, day);
    }

    private void serve(UUID userId, Instant at) {
        jdbc.update("INSERT INTO ad_serves(id,user_id,served_at) VALUES (?,?,?)", UUID.randomUUID(), userId, utc(at));
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
        try (PreparedStatement statement = probe.prepareStatement("SELECT 1 FROM ads WHERE id=? " + strength)) {
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
