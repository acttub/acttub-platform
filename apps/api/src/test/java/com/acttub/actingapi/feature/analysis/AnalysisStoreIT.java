package com.acttub.actingapi.feature.analysis;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.analysis.app.AnalysisResult;
import com.acttub.actingapi.feature.analysis.app.PracticeAnalysisStore;
import com.acttub.actingapi.integration.observation.ObservationItem;
import com.acttub.actingapi.integration.observation.ObservationPack;
import com.acttub.actingapi.integration.observation.SpeechFacts;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.assertj.core.api.SoftAssertions;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;

/**
 * 분석 저장소({@code PostgresPracticeAnalysisStore})가 내는 결과·잠금·경합·문장 수를 실제 PostgreSQL 에서 고정한다. 자기 표
 * ({@code analyses})만 쓰는 문장(분석 기록 넣기)을 네이티브 SQL 에서 HQL 로 옮길 때 네이티브 구현에서 먼저 통과시킨 이 테스트가
 * 그대로 통과해야 한다(apps/api/CONTRACT.md §5-9). 다른 기능의 표를 읽고 쓰는 문장은 네이티브로 남겨 문장 테스트에서만 본다.
 *
 * <p>워커를 거친 완료·실패 갈래·시도 소진·lease·탈퇴·그만두기와의 경합은 {@link PracticeAnalysisIT} 가 본다. 여기서는 그 테스트가
 * 밟지 않는 분석 기록의 모든 칸과 시각의 정밀도, 기록 JSON 의 글자 그대로, 빈 관찰 묶음·관찰 묶음 없음, 두 번째 완료가 돌려주는
 * id, 다른 연결이 같은 회차의 기록을 넣는 중일 때, 포트 메서드마다 나가는 문장을 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.analysis.AnalysisStoreIT$Recorder"
})
// 이 클래스만 쓰는 설정(StatementInspector)이라 끝나면 닫는다.
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class AnalysisStoreIT {

    /** 이 스레드가 보낸 SQL 을 모은다. 경합 쪽 스레드의 문장은 섞이지 않는다. */
    public static class Recorder implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    private static final Duration LEASE = Duration.ofMinutes(30);

    @Value("${spring.datasource.url}")
    private String databaseUrl;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PracticeAnalysisStore store;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        Recorder.STATEMENTS.get().clear();
    }

    // ---- 분석 기록 ----

    @Test
    @DisplayName("complete 는 분석 기록의 모든 칸을 적고 돌려준 id 가 그 행의 id 다. 두 시각은 넘긴 시각을 마이크로초로 반올림한 값이다")
    void completeWritesEveryAnalysisColumn() {
        Running job = runningJob();
        Instant at = now.plusNanos(123_456_789);

        UUID id = store.complete(job.id, job.lease, new AnalysisResult(pack(List.of()), false, 9_000), "model-a", at);

        Instant rounded = now.plus(123_457, ChronoUnit.MICROS);
        Map<String, Object> row = jdbc.queryForMap("SELECT * FROM analyses");
        assertThat(row).containsEntry("id", id).containsEntry("practice_id", job.practice)
                .containsEntry("format", "legacy").containsEntry("status", "ready").containsEntry("model", "model-a");
        assertThat(((OffsetDateTime) jdbc.queryForObject("SELECT created_at FROM analyses", OffsetDateTime.class)).toInstant())
                .isEqualTo(rounded);
        assertThat(((OffsetDateTime) jdbc.queryForObject("SELECT completed_at FROM analyses", OffsetDateTime.class)).toInstant())
                .isEqualTo(rounded);
    }

    @Test
    @DisplayName("complete 의 기록은 관찰 묶음을 JSON 으로 쓴 것이고 jsonb 가 저장한 글자(소수·한글·빈 목록 포함)가 이것과 같다. 못 본 구간이 있으면 partial 이다")
    void theRecordIsTheObservationPackAsJson() {
        Running job = runningJob();

        store.complete(job.id, job.lease, new AnalysisResult(pack(List.of("0:10~0:20 은 보지 못했어요")), false, 9_000),
                "model-a", now);

        assertThat(jdbc.queryForObject("SELECT status FROM analyses", String.class)).isEqualTo("partial");
        assertThat(jdbc.queryForObject("SELECT CAST(record AS text) FROM analyses", String.class)).isEqualTo(
                "{\"speech\": {\"chunks\": [{\"mark\": \"보통\", \"rate\": 6.7, \"text\": \"지금 놓치면 끝이야\", \"end_ms\": 1200, "
                        + "\"start_ms\": 0, \"delta_pct\": 0}], \"pauses\": [], \"transcript\": \"지금 놓치면 끝이야\", "
                        + "\"avg_syllables_per_sec\": 6.7}, \"timeline\": \"0:00 에 돌아선다\", \"observations\": [{\"what\": "
                        + "\"호흡이 얕다\", \"quote\": \"지금 놓치면 끝이야\", \"end_ms\": 1200, \"start_ms\": 0, \"dimension\": "
                        + "\"호흡\", \"confidence\": 0.8}], \"scene_summary\": \"문 앞에서 돌아선다\", \"uncertainties\": "
                        + "[\"0:10~0:20 은 보지 못했어요\"]}");
    }

    @Test
    @DisplayName("complete 는 빈 관찰 묶음(신형 회차)이면 빈 칸을 그대로 적고 ready 다. 관찰 묶음이 없으면 기록은 JSON null 이고 받아쓰기를 만들지 않는다")
    void emptyAndMissingObservationPacks() {
        Running empty = runningJob();
        store.complete(empty.id, empty.lease, new AnalysisResult(new ObservationPack("", List.of(), List.of()), false, 9_000),
                "model-a", now);
        assertThat(jdbc.queryForMap("SELECT status, CAST(record AS text) AS record FROM analyses WHERE practice_id=?",
                empty.practice)).containsEntry("status", "ready")
                .containsEntry("record", "{\"timeline\": \"\", \"observations\": [], \"scene_summary\": \"\", \"uncertainties\": []}");

        Running missing = runningJob();
        store.complete(missing.id, missing.lease, new AnalysisResult(null, false, 9_000), "model-a", now);
        assertThat(jdbc.queryForMap("SELECT status, CAST(record AS text) AS record, record IS NULL AS sql_null FROM analyses WHERE practice_id=?",
                missing.practice)).containsEntry("status", "ready").containsEntry("record", "null").containsEntry("sql_null", false);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM video_transcripts WHERE video_id=?", Integer.class, missing.video))
                .isZero();
    }

    @Test
    @DisplayName("같은 회차에 기록이 이미 있으면 complete 는 덮지 않고 새로 뽑은 id 를 돌려준다(그 id 의 행은 없다). 회차·작업은 그대로 닫힌다")
    void aSecondCompletionKeepsTheFirstRecordAndReturnsAnUnstoredId() {
        Running job = runningJob();
        UUID first = store.complete(job.id, job.lease, new AnalysisResult(pack(List.of()), false, 9_000), "model-a", now);
        Map<String, Object> before = jdbc.queryForMap("SELECT id, model, CAST(record AS text) AS record FROM analyses");

        jdbc.update("UPDATE practices SET stage='analyzing' WHERE id=?", job.practice);
        Running again = job(job.owner, job.practice, job.video);
        UUID second = store.complete(again.id, again.lease,
                new AnalysisResult(new ObservationPack("덮어쓴 장면", List.of(), List.of()), false, 9_000), "model-b",
                now.plusSeconds(60));

        assertThat(second).isNotNull().isNotEqualTo(first);
        assertThat(jdbc.queryForMap("SELECT id, model, CAST(record AS text) AS record FROM analyses")).isEqualTo(before);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM analyses WHERE id=?", Integer.class, second)).isZero();
        assertThat(jdbc.queryForObject("SELECT stage FROM practices WHERE id=?", String.class, job.practice))
                .isEqualTo("conversing");
        assertThat(jdbc.queryForObject("SELECT status FROM ai_jobs WHERE id=?", String.class, again.id)).isEqualTo("succeeded");
    }

    // ---- 경합 ----

    @Test
    @DisplayName("다른 연결이 같은 회차의 기록을 넣는 중이면 complete 는 회차 잠금에서 기다렸다가, 그쪽이 커밋하면 덮지 않고 되돌리면 자기 기록을 넣는다")
    void anotherConnectionInsertingTheSameRecord() throws Exception {
        Running committed = runningJob();
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            insertRecord(probe, committed.practice, "{\"other\": true}");
            Future<UUID> blocked = pool.submit(() -> store.complete(committed.id, committed.lease,
                    new AnalysisResult(pack(List.of()), false, 9_000), "model-a", now));
            assertThat(awaitStatementWaitingOn("practices")).startsWith("select");
            probe.commit();
            assertThat(blocked.get(20, TimeUnit.SECONDS)).isNotNull();
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT CAST(record AS text) FROM analyses WHERE practice_id=?", String.class,
                committed.practice)).isEqualTo("{\"other\": true}");

        Running rolledBack = runningJob();
        pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            insertRecord(probe, rolledBack.practice, "{\"other\": true}");
            Future<UUID> blocked = pool.submit(() -> store.complete(rolledBack.id, rolledBack.lease,
                    new AnalysisResult(pack(List.of()), false, 9_000), "model-a", now));
            awaitStatementWaitingOn("practices");
            probe.rollback();
            UUID id = blocked.get(20, TimeUnit.SECONDS);
            assertThat(jdbc.queryForObject("SELECT id FROM analyses WHERE practice_id=?", UUID.class, rolledBack.practice))
                    .isEqualTo(id);
        } finally {
            pool.shutdownNow();
        }
    }

    // ---- 문장 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류")
    void eachPortMethodSendsTheseStatements() {
        SoftAssertions soft = new SoftAssertions();
        UUID owner = user("active");
        UUID video = video(owner);
        UUID practice = practice(owner, video);
        UUID pending = pendingJob(owner, practice);

        soft.assertThat(statementsOf(() -> store.getContext(pending))).containsExactly("select ai_jobs");
        UUID lease = UUID.randomUUID();
        soft.assertThat(statementsOf(() -> store.claimNext(lease, LEASE, now)))
                .containsExactly("with select for update skip locked");
        soft.assertThat(statementsOf(() -> store.complete(pending, lease, new AnalysisResult(pack(List.of()), false, 9_000),
                "model-a", now)))
                .containsExactly(
                        "select ai_jobs for update of p",
                        "select ai_jobs for update",
                        "insert analyses on conflict",
                        "insert video_transcripts on conflict",
                        "update practices",
                        "update videos",
                        "select ai_jobs",
                        "update ai_jobs");
        soft.assertThat(statementsOf(() -> store.complete(pending, lease, new AnalysisResult(pack(List.of()), false, 9_000),
                "model-a", now)))
                .as("작업이 이미 닫혔으면 기록을 넣지 않는다")
                .containsExactly("select ai_jobs for update of p", "select ai_jobs for update");

        UUID gone = user("active");
        UUID goneVideo = video(gone);
        UUID gonePractice = practice(gone, goneVideo);
        UUID goneJob = pendingJob(gone, gonePractice);
        UUID goneLease = UUID.randomUUID();
        store.claimNext(goneLease, LEASE, now);
        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", gone);
        soft.assertThat(statementsOf(() -> store.complete(goneJob, goneLease, new AnalysisResult(pack(List.of()), false, 9_000),
                "model-a", now)))
                .as("탈퇴가 먼저면 작업만 닫는다")
                .containsExactly("select ai_jobs for update of p", "select ai_jobs for update", "select ai_jobs", "update ai_jobs");

        UUID failing = pendingJob(owner, practice(owner, video(owner)));
        UUID failingLease = UUID.randomUUID();
        store.claimNext(failingLease, LEASE, now);
        soft.assertThat(statementsOf(() -> store.fail(failing, failingLease, "timeout", "timeout", now)))
                .containsExactly("select ai_jobs", "update ai_jobs", "update practices");
        soft.assertThat(statementsOf(() -> store.sweepMaxAttempts(now)))
                .containsExactly("select ai_jobs", "update ai_jobs", "update ai_jobs returning");
        soft.assertAll();
    }

    // ---- 도움 ----

    private record Running(UUID owner, UUID video, UUID practice, UUID id, UUID lease) {
    }

    private Running runningJob() {
        UUID owner = user("active");
        UUID video = video(owner);
        return job(owner, practice(owner, video), video);
    }

    private Running job(UUID owner, UUID practice, UUID video) {
        UUID id = pendingJob(owner, practice);
        UUID lease = UUID.randomUUID();
        assertThat(store.claimNext(lease, LEASE, now)).isEqualTo(id);
        return new Running(owner, video, practice, id, lease);
    }

    private UUID user(String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,?)", id, status);
        return id;
    }

    private UUID video(UUID owner) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO videos(id,user_id,object_key,content_type,byte_size,duration_ms)
                VALUES (?,?,?,'video/mp4',1000,0)
                """, id, owner, "videos/" + owner + "/" + id + ".mp4");
        return id;
    }

    private UUID practice(UUID owner, UUID videoId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO practices(id,user_id,video_id,root_id,ordinal,stage,experience_version,
                                      blockage_kind,sub_branch)
                VALUES (?,?,?,?,1,'analyzing','legacy','그 외','그 외')
                """, id, owner, videoId, id);
        return id;
    }

    private UUID pendingJob(UUID owner, UUID practiceId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO ai_jobs(id,user_id,kind,target_id,request_id,request_fingerprint,status,created_at)
                VALUES (?,?,'analyze',?,?,?,'pending',?)
                """, id, owner, practiceId, UUID.randomUUID(), "f".repeat(64), now.minusSeconds(60).atOffset(ZoneOffset.UTC));
        return id;
    }

    private static ObservationPack pack(List<String> uncertainties) {
        return new ObservationPack(
                "문 앞에서 돌아선다",
                "0:00 에 돌아선다",
                SpeechFacts.calculate("지금 놓치면 끝이야", List.of(
                        new SpeechFacts.Word("지금", 0, .3),
                        new SpeechFacts.Word("놓치면", .3, .6),
                        new SpeechFacts.Word("끝이야", .6, 1.2))),
                List.of(new ObservationItem(0, 1200, "호흡이 얕다", "지금 놓치면 끝이야", "호흡", 0.8)),
                uncertainties);
    }

    private static final Pattern WITH_CHANGE = Pattern.compile("^with \\w+ as \\( ?(insert into|update|delete from) (\\w+)\\b.*");
    private static final Pattern INSERT = Pattern.compile("^insert into (\\w+)\\b.*");
    private static final Pattern UPDATE = Pattern.compile("^update (\\w+)\\b.*");
    private static final Pattern DELETE = Pattern.compile("^delete from (\\w+)\\b.*");
    private static final Pattern TABLE = Pattern.compile("^(\\w+)\\b.*");
    private static final Pattern LOCK = Pattern.compile(" for update( of \\w+)?( skip locked)?");

    /**
     * 문장을 "<종류> <표>[ 덧붙임]" 으로 줄인다. 별칭·열 목록·매개변수 표기는 두 구현이 달라 견주지 않는다. SELECT 의 표는 바깥
     * FROM 의 첫 표다.
     */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        String conflict = text.contains(" on conflict") ? " on conflict" : "";
        String returning = text.contains(" returning ") ? " returning" : "";
        Matcher locked = LOCK.matcher(text);
        String lock = locked.find() ? locked.group() : "";
        Matcher matcher;
        if ((matcher = WITH_CHANGE.matcher(text)).matches()) {
            return matcher.group(1).split(" ")[0] + " " + matcher.group(2) + conflict + returning;
        }
        if (text.startsWith("with ")) {
            return "with select" + lock;
        }
        if (text.startsWith("select ")) {
            return "select " + outerTable(text) + lock;
        }
        if ((matcher = INSERT.matcher(text)).matches()) {
            return "insert " + matcher.group(1) + conflict + returning;
        }
        if ((matcher = UPDATE.matcher(text)).matches()) {
            return "update " + matcher.group(1) + returning;
        }
        if ((matcher = DELETE.matcher(text)).matches()) {
            return "delete " + matcher.group(1) + returning;
        }
        return text;
    }

    /** 괄호 밖에 있는 첫 " from " 뒤의 표 이름. */
    private static String outerTable(String text) {
        int depth = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '(') {
                depth++;
            } else if (c == ')') {
                depth--;
            } else if (depth == 0 && text.startsWith(" from ", i)) {
                Matcher matcher = TABLE.matcher(text.substring(i + " from ".length()));
                return matcher.matches() ? matcher.group(1) : "(subquery)";
            }
        }
        return "?";
    }

    private List<String> statementsOf(Supplier<?> call) {
        Recorder.STATEMENTS.get().clear();
        call.get();
        List<String> sent = Recorder.STATEMENTS.get().stream().map(AnalysisStoreIT::label).toList();
        Recorder.STATEMENTS.get().clear();
        return sent;
    }

    private Connection probe() throws SQLException {
        Connection probe = DriverManager.getConnection(databaseUrl,
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
        probe.setAutoCommit(false);
        return probe;
    }

    private void insertRecord(Connection probe, UUID practice, String record) throws SQLException {
        try (PreparedStatement statement = probe.prepareStatement("""
                INSERT INTO analyses(id,practice_id,format,status,model,record,created_at,completed_at)
                VALUES (?,?,'legacy','ready','other',CAST(? AS jsonb),now(),now())
                """)) {
            statement.setObject(1, UUID.randomUUID());
            statement.setObject(2, practice);
            statement.setString(3, record);
            statement.execute();
        }
    }

    /** 그 표를 쓰는 문장이 잠금을 기다리면 그 문장을 소문자로 낸다. */
    private String awaitStatementWaitingOn(String table) throws Exception {
        Instant deadline = Instant.now().plusSeconds(10);
        while (Instant.now().isBefore(deadline)) {
            List<String> waiting = jdbc.queryForList("""
                    SELECT query FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event_type='Lock'
                      AND query ILIKE ?
                    """, String.class, "%" + table + "%");
            if (!waiting.isEmpty()) {
                return waiting.getFirst().strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
            }
            Thread.sleep(10);
        }
        throw new AssertionError("complete 가 잠금 뒤에서 기다리지 않았다");
    }
}
