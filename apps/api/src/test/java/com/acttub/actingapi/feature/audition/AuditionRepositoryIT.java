package com.acttub.actingapi.feature.audition;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.time.Instant;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

import com.acttub.actingapi.feature.audition.app.AuditionRepository;
import com.acttub.actingapi.feature.audition.app.AuditionService;
import com.acttub.actingapi.feature.audition.domain.AuditionPosting;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 오디션 공고 저장소의 네 문장이 지금 내는 결과·영향 행 수·경합·문장을 실제 PostgreSQL 에서 고정한다. 저장소를 네이티브
 * SQL 에서 JPA 로 옮길 때 같은 테스트가 그대로 통과해야 한다(apps/api/CONTRACT.md §5-9).
 *
 * <p>모으기를 두 번 했을 때 한 행·마감 표시 걸러 내기·삭제 경계·0건 출처·응답 모양·한국 날짜는 {@link AuditionEndpointIT} 가
 * 서비스와 HTTP 로 본다. 여기서는 그 테스트가 밟지 않는 DB 가 매기는 id, 값이 NULL 로 바뀌는 갱신, 같은 출처 번호의 다른
 * 출처, 한 번의 저장이 실패하면 함께 되돌리기, 영향 행 수, 동시에 들어온 같은 공고, 열림 후보의 경계, 지운 수, 시각의
 * 정밀도, 주기 작업과 요청 경로가 내는 문장을 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "AUDITION_ENABLED=true",
    "AUDITION_SOURCES=otr,emk",
    "AUDITION_COLLECT_CRON=-",
    "AUDITION_COLLECT_STARTUP_DELAY_MS=3600000",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.audition.AuditionRepositoryIT$Recorder"
})
@Import({MutableClock.Fixture.class, AuditionEndpointIT.Fixture.class})
class AuditionRepositoryIT {

    /** 이 스레드가 보낸 SQL 을 모은다. 경합 쪽 스레드의 문장은 섞이지 않는다. */
    public static class Recorder implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    /** 2026-10-08 09:00 KST. */
    private static final Instant NOW = Instant.parse("2026-10-08T00:00:00Z");
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 8);

    /** 칸마다 다른 값을 넣은 공고. 출처 번호(ref)로 고른다. */
    private static AuditionPosting full(String source, String ref) {
        return new AuditionPosting(source, ref, "연극 배우 모집 " + ref, "theater", "회당 5만원", TODAY.minusDays(3),
                TODAY.plusDays(5), "모집중", TODAY.minusDays(2), "https://example.com/" + source + "/" + ref);
    }

    private static AuditionPosting sparse(String source, String ref, LocalDate end, LocalDate posted) {
        return new AuditionPosting(source, ref, "공고 " + ref, "film", null, null, end, null, posted,
                "https://example.com/" + source + "/" + ref);
    }

    @Value("${spring.datasource.url}")
    private String databaseUrl;

    @Autowired JdbcTemplate jdbc;
    @Autowired AuditionRepository postings;
    @Autowired AuditionService auditions;
    @Autowired AuditionEndpointIT.FakeSources sources;
    @Autowired MutableClock clock;
    @Autowired PlatformTransactionManager transactionManager;

    @BeforeEach
    void reset() {
        jdbc.execute("TRUNCATE TABLE audition_postings RESTART IDENTITY");
        sources.postings.clear();
        clock.set(NOW);
        Recorder.STATEMENTS.get().clear();
    }

    @Test
    @DisplayName("upsert 는 새 공고를 DB 가 매긴 id 로 넣고 처음·마지막 본 시각을 둘 다 now 로, 마이크로초로 반올림해 적는다. 빈 칸은 NULL 이다")
    void upsertInsertsNewPostings() {
        Instant seen = NOW.plusNanos(123_456_789);

        postings.upsert(List.of(full("otr", "1"), sparse("otr", "2", null, TODAY)), seen);

        assertThat(jdbc.queryForList("SELECT id FROM audition_postings ORDER BY id", Long.class)).containsExactly(1L, 2L);
        assertThat(row("otr", "1")).isEqualTo(full("otr", "1"));
        assertThat(row("otr", "2")).isEqualTo(sparse("otr", "2", null, TODAY));
        assertThat(seenTimes("otr", "1")).containsExactly(
                NOW.plus(123_457, ChronoUnit.MICROS), NOW.plus(123_457, ChronoUnit.MICROS));
    }

    @Test
    @DisplayName("upsert 는 같은 (출처, 번호) 의 모든 사실 칸을 새 값으로 바꾸고(NULL 로도) 마지막 본 시각만 고친다. id·처음 본 시각은 그대로, 같은 번호의 다른 출처는 다른 행이다")
    void upsertUpdatesEveryFactOfTheSamePosting() {
        postings.upsert(List.of(full("otr", "1"), full("emk", "1")), NOW);
        long id = jdbc.queryForObject("SELECT id FROM audition_postings WHERE source='otr' AND source_ref='1'", Long.class);
        AuditionPosting changed = new AuditionPosting("otr", "1", "바뀐 제목", "musical", null, null, null, null,
                TODAY.minusDays(1), "https://example.com/otr/1-moved");

        postings.upsert(List.of(changed), NOW.plusSeconds(43_200));

        assertThat(row("otr", "1")).isEqualTo(changed);
        assertThat(jdbc.queryForObject("SELECT id FROM audition_postings WHERE source='otr' AND source_ref='1'", Long.class))
                .isEqualTo(id);
        assertThat(seenTimes("otr", "1")).containsExactly(NOW, NOW.plusSeconds(43_200));
        assertThat(row("emk", "1")).isEqualTo(full("emk", "1"));
        assertThat(seenTimes("emk", "1")).containsExactly(NOW, NOW);
    }

    @Test
    @DisplayName("한 번의 upsert 는 한 트랜잭션이다 — 하나가 CHECK 에 걸리면 앞에서 넣은 것도 함께 되돌린다")
    void oneUpsertIsOneTransaction() {
        AuditionPosting badUrl = new AuditionPosting("otr", "bad", "제목", "theater", null, null, null, null, TODAY,
                "http://example.com/otr/bad");

        assertThatThrownBy(() -> postings.upsert(List.of(full("otr", "1"), badUrl), NOW))
                .hasStackTraceContaining("ck_audition_postings_source_url");

        assertThat(jdbc.queryForObject("SELECT count(*) FROM audition_postings", Integer.class)).isZero();
    }

    @Test
    @DisplayName("영향 행 수: 이미 있는 공고 하나와 새 공고 하나를 upsert 하면 그 트랜잭션에서 넣은 행 1, 고친 행 1, 지운 행 0 이다")
    void upsertTouchesOneRowPerPosting() {
        postings.upsert(List.of(full("otr", "1"), full("otr", "2")), NOW);
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);

        // 이 연결이 아직 내보내지 않은 앞 트랜잭션의 수도 함께 보이므로, 같은 트랜잭션 안에서 앞뒤 차이를 본다.
        List<Long> touched = transaction.execute(tx -> {
            List<Long> before = tupleCounts();
            postings.upsert(List.of(full("otr", "1"), full("otr", "3")), NOW.plusSeconds(60));
            List<Long> after = tupleCounts();
            return List.of(after.get(0) - before.get(0), after.get(1) - before.get(1), after.get(2) - before.get(2));
        });

        assertThat(touched).as("넣은 행, 고친 행, 지운 행").containsExactly(1L, 1L, 0L);
        assertThat(seenTimes("otr", "2")).as("목록에 없던 공고는 건드리지 않는다").containsExactly(NOW, NOW);
    }

    @Test
    @DisplayName("같은 공고를 다른 트랜잭션이 막 넣고 있으면 upsert 는 그 커밋을 기다렸다가 갱신으로 끝난다. 그쪽이 되돌리면 새로 넣는다")
    void concurrentInsertOfTheSamePosting() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection other = DriverManager.getConnection(databaseUrl,
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword())) {
            other.setAutoCommit(false);
            insertDirectly(other, "committed", NOW.minusSeconds(600));
            Future<?> waiting = pool.submit(() -> postings.upsert(List.of(full("otr", "committed")), NOW));
            assertThat(awaitStatementWaitingOn("audition_postings").toLowerCase()).startsWith("insert into audition_postings");
            other.commit();
            waiting.get(20, TimeUnit.SECONDS);

            assertThat(jdbc.queryForObject("SELECT count(*) FROM audition_postings WHERE source_ref='committed'", Integer.class))
                    .isOne();
            assertThat(row("otr", "committed")).isEqualTo(full("otr", "committed"));
            assertThat(seenTimes("otr", "committed")).as("처음 본 시각은 먼저 넣은 쪽 것이다")
                    .containsExactly(NOW.minusSeconds(600), NOW);

            insertDirectly(other, "rolled-back", NOW.minusSeconds(600));
            Future<?> inserting = pool.submit(() -> postings.upsert(List.of(full("otr", "rolled-back")), NOW));
            awaitStatementWaitingOn("audition_postings");
            other.rollback();
            inserting.get(20, TimeUnit.SECONDS);

            assertThat(seenTimes("otr", "rolled-back")).containsExactly(NOW, NOW);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("openCandidates 는 마감일이 오늘 이후(오늘 포함)이거나, 마감일 없이 게시일이 45일 안(45일째 포함)인 행만 모든 칸과 함께 낸다. 마감 표시는 거르지 않는다")
    void openCandidatesBoundaries() {
        AuditionPosting endsToday = sparse("otr", "ends-today", TODAY, TODAY.minusDays(9));
        AuditionPosting endedYesterday = sparse("otr", "ended-yesterday", TODAY.minusDays(1), TODAY.minusDays(9));
        AuditionPosting noEnd45 = sparse("otr", "no-end-45", null, TODAY.minusDays(45));
        AuditionPosting noEnd46 = sparse("otr", "no-end-46", null, TODAY.minusDays(46));
        AuditionPosting oldButEnding = sparse("otr", "old-but-ending", TODAY.plusDays(1), TODAY.minusDays(300));
        AuditionPosting closedMarker = new AuditionPosting("emk", "closed", "공고 (마감)", "musical", "협의",
                TODAY.minusDays(1), TODAY.plusDays(3), "접수마감", TODAY, "https://example.com/emk/closed");
        postings.upsert(List.of(endsToday, endedYesterday, noEnd45, noEnd46, oldButEnding, closedMarker), NOW);

        assertThat(postings.openCandidates(TODAY))
                .containsExactlyInAnyOrder(endsToday, noEnd45, oldButEnding, closedMarker);
        assertThat(postings.openCandidates(TODAY.plusYears(5))).isEmpty();
    }

    @Test
    @DisplayName("deleteExpired 는 마감 30일 넘은 행과 마감일 없이 게시 180일 넘은 행을 지우고 지운 수를 낸다. 다시 부르면 0 이다")
    void deleteExpiredReturnsTheDeletedCount() {
        postings.upsert(List.of(
                sparse("otr", "ended-30", TODAY.minusDays(30), TODAY.minusDays(60)),
                sparse("otr", "ended-31", TODAY.minusDays(31), TODAY.minusDays(60)),
                sparse("otr", "posted-180", null, TODAY.minusDays(180)),
                sparse("otr", "posted-181", null, TODAY.minusDays(181)),
                sparse("otr", "old-but-ending", TODAY, TODAY.minusDays(400))), NOW);

        assertThat(postings.deleteExpired(TODAY)).isEqualTo(2);
        assertThat(postings.deleteExpired(TODAY)).isZero();
        assertThat(jdbc.queryForList("SELECT source_ref FROM audition_postings ORDER BY source_ref", String.class))
                .containsExactly("ended-30", "old-but-ending", "posted-180");
    }

    @Test
    @DisplayName("lastCollectedAt 은 비었으면 비어 있고, 아니면 마지막 본 시각의 최댓값을 마이크로초까지 낸다")
    void lastCollectedAtIsTheLatestSeenTime() {
        assertThat(postings.lastCollectedAt()).isEmpty();

        postings.upsert(List.of(full("otr", "1")), NOW.plusNanos(1_000));
        postings.upsert(List.of(full("emk", "1")), NOW.minusSeconds(60));

        assertThat(postings.lastCollectedAt()).contains(NOW.plusNanos(1_000));
    }

    @Test
    @DisplayName("upsert 의 문장: 공고마다 INSERT … ON CONFLICT (source, source_ref) DO UPDATE 하나. id 는 넣지 않고 사실 칸 여덟과 마지막 본 시각을 excluded 로 고친다")
    void upsertSendsOneConflictUpdatePerPosting() {
        List<String> sent = statementsOf(() -> {
            postings.upsert(List.of(full("otr", "1"), sparse("otr", "2", null, TODAY)), NOW);
            return null;
        });

        assertThat(sent).hasSize(2).allSatisfy(sql -> {
            Upsert upsert = Upsert.parse(sql);
            assertThat(upsert.columns()).containsExactlyInAnyOrder("source", "source_ref", "title", "category",
                    "pay_text", "apply_start", "apply_end", "status_text", "posted_on", "source_url", "first_seen_at",
                    "last_seen_at");
            assertThat(upsert.target()).containsExactly("source", "source_ref");
            assertThat(upsert.set()).containsOnlyKeys("title", "category", "pay_text", "apply_start", "apply_end",
                    "status_text", "posted_on", "source_url", "last_seen_at");
            upsert.set().forEach((column, value) -> assertThat(value).isEqualTo("excluded." + column));
        });
    }

    @Test
    @DisplayName("주기 작업의 모으기는 공고마다 upsert 하나와 끝의 DELETE 하나를, 기동 뒤 확인은 그 앞에 max 조회 하나를 낸다")
    void scheduledCollectStatements() {
        sources.postings.put("otr", List.of(full("otr", "1"), full("otr", "2")));
        sources.postings.put("emk", List.of(full("emk", "1")));

        assertThat(statementsOf(auditions::collect)).satisfiesExactly(
                first -> assertThat(Upsert.parse(first).target()).containsExactly("source", "source_ref"),
                second -> assertThat(Upsert.parse(second).target()).containsExactly("source", "source_ref"),
                third -> assertThat(Upsert.parse(third).target()).containsExactly("source", "source_ref"),
                delete -> assertThat(delete).matches("(?is)delete\\s+from\\s+audition_postings\\b.*"));

        clock.set(NOW.plusSeconds(13 * 3600));
        assertThat(statementsOf(auditions::collectIfStale)).hasSize(5).first()
                .satisfies(sql -> assertThat(sql).matches("(?is)select\\s+max\\(.*\\)\\s.*from\\s+audition_postings\\b.*"));
    }

    @Test
    @DisplayName("요청 경로(GET /v2/auditions 의 목록)는 열림 후보 SELECT 하나와 max 조회 하나를 낸다")
    void requestPathStatements() {
        postings.upsert(List.of(full("otr", "1")), NOW);

        assertThat(statementsOf(auditions::list)).satisfiesExactly(
                candidates -> assertThat(candidates).matches("(?is)select\\s.*\\sfrom\\s+audition_postings\\b.*\\swhere\\s.*"),
                latest -> assertThat(latest).matches("(?is)select\\s+max\\(.*\\)\\s.*from\\s+audition_postings\\b.*"));
    }

    /** INSERT … ON CONFLICT … DO UPDATE SET … 를 넣는 칸, 충돌 대상, 고치는 칸(칸 → 값)으로 나눈다. 별칭은 지운다. */
    private record Upsert(List<String> columns, List<String> target, Map<String, String> set) {
        private static final Pattern SHAPE = Pattern.compile(
                "insert into audition_postings(?: as \\w+)?\\s*\\(([^)]*)\\)\\s*values\\s*\\(.*\\)\\s*"
                        + "on conflict\\s*\\(([^)]*)\\)\\s*do update\\s+set\\s+(.*)",
                Pattern.DOTALL);

        static Upsert parse(String sql) {
            Matcher matcher = SHAPE.matcher(sql.toLowerCase().strip().replaceAll("\\s+", " "));
            assertThat(matcher.matches()).as("INSERT … ON CONFLICT (…) DO UPDATE SET … 꼴이 아니다: %s", sql).isTrue();
            return new Upsert(names(matcher.group(1)), names(matcher.group(2)),
                    Arrays.stream(matcher.group(3).split(","))
                            .map(String::strip)
                            .map(pair -> pair.split("=", 2))
                            .collect(Collectors.toMap(pair -> unaliased(pair[0]), pair -> pair[1].strip())));
        }

        private static List<String> names(String list) {
            return Arrays.stream(list.split(",")).map(Upsert::unaliased).toList();
        }

        private static String unaliased(String name) {
            String bare = name.strip();
            return bare.contains(".") && !bare.startsWith("excluded.") ? bare.substring(bare.indexOf('.') + 1) : bare;
        }
    }

    private AuditionPosting row(String source, String ref) {
        return jdbc.queryForObject("""
                SELECT source,source_ref,title,category,pay_text,apply_start,apply_end,status_text,posted_on,source_url
                FROM audition_postings WHERE source=? AND source_ref=?
                """, (rs, n) -> new AuditionPosting(rs.getString("source"), rs.getString("source_ref"),
                rs.getString("title"), rs.getString("category"), rs.getString("pay_text"),
                rs.getObject("apply_start", LocalDate.class), rs.getObject("apply_end", LocalDate.class),
                rs.getString("status_text"), rs.getObject("posted_on", LocalDate.class), rs.getString("source_url")),
                source, ref);
    }

    /** [처음 본 시각, 마지막 본 시각]. */
    private List<Instant> seenTimes(String source, String ref) {
        return jdbc.queryForObject("""
                SELECT first_seen_at, last_seen_at FROM audition_postings WHERE source=? AND source_ref=?
                """, (rs, n) -> List.of(rs.getObject("first_seen_at", OffsetDateTime.class).toInstant(),
                rs.getObject("last_seen_at", OffsetDateTime.class).toInstant()), source, ref);
    }

    private static void insertDirectly(Connection connection, String ref, Instant seen) throws Exception {
        try (PreparedStatement statement = connection.prepareStatement("""
                INSERT INTO audition_postings(source,source_ref,title,category,posted_on,source_url,first_seen_at,last_seen_at)
                VALUES ('otr',?,'먼저 넣은 제목','other',?,?,?,?)
                """)) {
            statement.setString(1, ref);
            statement.setObject(2, TODAY);
            statement.setString(3, "https://example.com/first/" + ref);
            statement.setObject(4, seen.atOffset(ZoneOffset.UTC));
            statement.setObject(5, seen.atOffset(ZoneOffset.UTC));
            statement.executeUpdate();
        }
    }

    /** 이 연결의 [넣은 행, 고친 행, 지운 행]. 같은 트랜잭션 안에서 불러야 한다. */
    private List<Long> tupleCounts() {
        return jdbc.queryForObject("""
                SELECT n_tup_ins, n_tup_upd, n_tup_del FROM pg_stat_xact_user_tables WHERE relname='audition_postings'
                """, (rs, n) -> List.of(rs.getLong("n_tup_ins"), rs.getLong("n_tup_upd"), rs.getLong("n_tup_del")));
    }

    private List<String> statementsOf(Supplier<?> call) {
        Recorder.STATEMENTS.get().clear();
        call.get();
        List<String> sent = List.copyOf(Recorder.STATEMENTS.get());
        Recorder.STATEMENTS.get().clear();
        return sent;
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
        throw new AssertionError("upsert 가 먼저 넣고 있는 같은 공고 뒤에서 기다리지 않았다");
    }
}
