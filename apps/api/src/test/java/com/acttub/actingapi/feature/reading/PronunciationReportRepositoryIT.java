package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.reading.app.PronunciationReportRepository;
import com.acttub.actingapi.feature.reading.app.PronunciationReportRepository.Claimed;
import com.acttub.actingapi.feature.reading.app.PronunciationReportRepository.LineSource;
import com.acttub.actingapi.feature.reading.app.PronunciationReportRepository.ReportState;
import com.acttub.actingapi.feature.reading.domain.PronunciationRules;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import tools.jackson.databind.ObjectMapper;

/**
 * 리딩 발음 보고서 장부이자 채점 작업 큐가 내는 결과·선점·경합·문장을 고정한다. 보고서를 청하고 채점하는 흐름은
 * {@link ReadingPronunciationIT} 가 본다. 여기서는 그 테스트가 밟지 않는 집는 순서, 다른 워커가 잡은 행 건너뛰기, 두 워커가 함께
 * 집을 때, 임대가 끝난 행을 다시 집거나 닫는 경계, 임대를 잃은 뒤의 완료·실패, 시각의 정밀도, 나가는 문장을 본다.
 *
 * <p>저장소를 네이티브 SQL 에서 JPA 로 옮길 때 문장 테스트 한 곳만 달라졌다 — 집는 문장
 * ({@code UPDATE … WHERE id=(SELECT … FOR UPDATE SKIP LOCKED) RETURNING})을 잠가 읽기와 임대 적기로 나눠 집을 것이 있을 때
 * 문장이 하나 늘었다. 결과·선점·경합 테스트는 고치지 않았다.
 */
class PronunciationReportRepositoryIT extends ReadingRepositoryFixture {

    private static final Duration LEASE = Duration.ofMinutes(5);

    @Autowired
    PronunciationReportRepository reports;

    @Autowired
    ObjectMapper mapper;

    private UUID owner;
    private UUID script;
    private UUID nina;

    @BeforeEach
    void setUp() {
        owner = member();
        script = script(owner);
        nina = character(script, "니나", 0);
    }

    @Test
    @DisplayName("findOrEnqueue: 끝난 회차면 queued 행을 한 번만 만들고 그 상태를 낸다. 끝나지 않은 회차는 not_ready 이고 행을 만들지 않는다. 남의 회차·없는 회차는 null 이다")
    void findOrEnqueueCreatesOnceForACompletedSession() {
        UUID open = completed(false);
        UUID done = completed(true);

        assertThat(reports.findOrEnqueue(owner, open, now)).isEqualTo(new ReportState("not_ready", null));
        assertThat(reports.findOrEnqueue(member(), done, now)).isNull();
        assertThat(reports.findOrEnqueue(owner, UUID.randomUUID(), now)).isNull();
        assertThat(count("reading_pronunciation_reports")).isZero();

        assertThat(reports.findOrEnqueue(owner, done, now.plusNanos(123_456_789))).isEqualTo(new ReportState("queued", null));
        assertThat(reports.findOrEnqueue(owner, done, now.plusSeconds(60))).isEqualTo(new ReportState("queued", null));

        assertThat(jdbc.queryForMap("SELECT reading_session_id,user_id,status,attempt_count,lease_token,result,failure "
                + "FROM reading_pronunciation_reports"))
                .containsEntry("reading_session_id", done).containsEntry("user_id", owner).containsEntry("status", "queued")
                .containsEntry("attempt_count", 0).containsEntry("lease_token", null).containsEntry("result", null)
                .containsEntry("failure", null);
        assertThat(instant("SELECT created_at FROM reading_pronunciation_reports")).isEqualTo(now.plus(123_457, ChronoUnit.MICROS));
        assertThat(instant("SELECT updated_at FROM reading_pronunciation_reports")).isEqualTo(now.plus(123_457, ChronoUnit.MICROS));
        assertThat(jdbc.queryForObject("SELECT id FROM reading_pronunciation_reports", UUID.class)).isNotNull();
    }

    @Test
    @DisplayName("claimNext: 기다리는 것 가운데 먼저 만든 것을 running 으로 집고 임대와 시도 수를 적는다. 없으면 null 이다")
    void claimNextTakesTheOldestQueuedReport() {
        UUID later = report(now.plusSeconds(10));
        UUID earlier = report(now);
        UUID token = UUID.randomUUID();

        Claimed claimed = reports.claimNext(token, LEASE, 3, now.plusSeconds(60).plusNanos(1_500));

        assertThat(claimed).isEqualTo(new Claimed(earlier, sessionOf(earlier), 1));
        assertThat(jdbc.queryForMap("SELECT status,lease_token,attempt_count FROM reading_pronunciation_reports WHERE id=?", earlier))
                .containsEntry("status", "running").containsEntry("lease_token", token).containsEntry("attempt_count", 1);
        Instant stamp = now.plusSeconds(60).plus(2, ChronoUnit.MICROS);
        assertThat(instant("SELECT lease_until FROM reading_pronunciation_reports WHERE id=?", earlier)).isEqualTo(stamp.plus(LEASE));
        assertThat(instant("SELECT updated_at FROM reading_pronunciation_reports WHERE id=?", earlier)).isEqualTo(stamp);
        assertThat(statusOf(later)).isEqualTo("queued");

        assertThat(reports.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(61)).reportId()).isEqualTo(later);
        assertThat(reports.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(62))).isNull();
    }

    @Test
    @DisplayName("claimNext: 임대가 끝난 running 은 시도가 남았으면 다시 집고(시도 +1, 새 임대), 다 썼으면 failed·lease_expired 로 닫는다. 임대가 끝나는 바로 그 시각에는 아직 집지 않는다")
    void claimNextReclaimsOrClosesExpiredLeases() {
        UUID report = report(now);
        UUID first = UUID.randomUUID();
        reports.claimNext(first, LEASE, 2, now);
        Instant leaseEnd = now.plus(LEASE);

        assertThat(reports.claimNext(UUID.randomUUID(), LEASE, 2, leaseEnd)).as("임대가 끝나는 시각").isNull();
        UUID second = UUID.randomUUID();
        assertThat(reports.claimNext(second, LEASE, 2, leaseEnd.plusSeconds(1)))
                .isEqualTo(new Claimed(report, sessionOf(report), 2));
        assertThat(jdbc.queryForObject("SELECT lease_token FROM reading_pronunciation_reports WHERE id=?", UUID.class, report))
                .isEqualTo(second);

        Instant afterSecond = leaseEnd.plusSeconds(1).plus(LEASE).plusSeconds(1);
        assertThat(reports.claimNext(UUID.randomUUID(), LEASE, 2, afterSecond)).as("시도를 다 썼다").isNull();
        assertThat(jdbc.queryForMap("SELECT status,failure,lease_token,lease_until,attempt_count "
                + "FROM reading_pronunciation_reports WHERE id=?", report))
                .containsEntry("status", "failed").containsEntry("failure", "lease_expired")
                .containsEntry("lease_token", null).containsEntry("lease_until", null).containsEntry("attempt_count", 2);
        assertThat(instant("SELECT updated_at FROM reading_pronunciation_reports WHERE id=?", report)).isEqualTo(afterSecond);
    }

    @Test
    @DisplayName("claimNext 는 다른 연결이 잡고 있는 행을 기다리지 않고 건너뛴다(SKIP LOCKED) — 그다음 것을 집고, 남은 것이 그 행뿐이면 null 이다")
    void claimNextSkipsARowLockedByAnotherWorker() throws Exception {
        UUID locked = report(now);
        UUID next = report(now.plusSeconds(10));
        try (Connection probe = probe()) {
            run(probe, "SELECT 1 FROM reading_pronunciation_reports WHERE id=? FOR UPDATE", locked);

            assertThat(reports.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(60)).reportId()).isEqualTo(next);
            assertThat(reports.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(61))).isNull();
            assertNothingWaits();
            probe.rollback();
        }
        assertThat(reports.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(62)).reportId()).isEqualTo(locked);
    }

    @Test
    @DisplayName("두 워커가 함께 집으면 서로 다른 행을 집는다. 한 워커가 집은 행은 그 트랜잭션이 끝날 때까지 잠겨 있어 다른 워커가 건너뛴다")
    void twoWorkersClaimDifferentReports() throws Exception {
        UUID first = report(now);
        UUID second = report(now.plusSeconds(10));
        CountDownLatch claimed = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try {
            Future<Claimed> holder = pool.submit(() -> inTransaction(() -> {
                Claimed mine = reports.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(60));
                claimed.countDown();
                await(release);
                return mine;
            }));
            await(claimed);
            Claimed other = reports.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(60));
            Claimed none = reports.claimNext(UUID.randomUUID(), LEASE, 3, now.plusSeconds(60));
            release.countDown();

            assertThat(holder.get(20, TimeUnit.SECONDS).reportId()).isEqualTo(first);
            assertThat(other.reportId()).isEqualTo(second);
            assertThat(none).isNull();
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT attempt_count FROM reading_pronunciation_reports", Integer.class)).containsExactly(1, 1);
    }

    @Test
    @DisplayName("complete: 임대를 쥔 워커만 상태·모델·결과를 적고 임대를 푼다. 임대를 잃었거나 running 이 아니면 false 이고 그대로다. 적은 결과는 findOrEnqueue 가 jsonb 를 글로 낸 것이다")
    void completeNeedsTheLease() throws Exception {
        UUID report = report(now);
        UUID token = UUID.randomUUID();
        reports.claimNext(token, LEASE, 3, now);
        PronunciationRules.Report result = PronunciationRules.build(List.of());

        assertThat(reports.complete(report, UUID.randomUUID(), "done", "pron-1", result, now.plusSeconds(5))).isFalse();
        assertThat(statusOf(report)).isEqualTo("running");

        assertThat(reports.complete(report, token, "done", "pron-1", result, now.plusSeconds(5))).isTrue();
        assertThat(jdbc.queryForMap("SELECT status,model_version,failure,lease_token,lease_until "
                + "FROM reading_pronunciation_reports WHERE id=?", report))
                .containsEntry("status", "done").containsEntry("model_version", "pron-1").containsEntry("failure", null)
                .containsEntry("lease_token", null).containsEntry("lease_until", null);
        assertThat(jdbc.queryForObject("SELECT result = CAST(? AS jsonb) FROM reading_pronunciation_reports WHERE id=?",
                Boolean.class, mapper.writeValueAsString(result), report)).isTrue();
        assertThat(instant("SELECT updated_at FROM reading_pronunciation_reports WHERE id=?", report)).isEqualTo(now.plusSeconds(5));
        assertThat(reports.findOrEnqueue(owner, sessionOf(report), now)).isEqualTo(new ReportState("done",
                jdbc.queryForObject("SELECT CAST(result AS text) FROM reading_pronunciation_reports WHERE id=?", String.class, report)));

        assertThat(reports.complete(report, token, "skipped", "pron-2", result, now.plusSeconds(9))).as("이미 닫혔다").isFalse();
        assertThat(statusOf(report)).isEqualTo("done");
    }

    @Test
    @DisplayName("fail: 임대를 쥔 워커만 이유를 적고 임대를 푼다 — 다시 할 것이면 queued, 아니면 failed 다. 임대를 잃었으면 false 이고 그대로다")
    void failNeedsTheLease() {
        UUID retried = report(now);
        UUID closed = report(now.plusSeconds(1));
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        reports.claimNext(first, LEASE, 3, now.plusSeconds(2));
        reports.claimNext(second, LEASE, 3, now.plusSeconds(2));

        assertThat(reports.fail(retried, second, "scorer_down", true, now.plusSeconds(3))).isFalse();
        assertThat(reports.fail(retried, first, "scorer_down", true, now.plusSeconds(3))).isTrue();
        assertThat(reports.fail(closed, second, "bad_audio", false, now.plusSeconds(4))).isTrue();

        assertThat(jdbc.queryForMap("SELECT status,failure,lease_token,lease_until,attempt_count "
                + "FROM reading_pronunciation_reports WHERE id=?", retried))
                .containsEntry("status", "queued").containsEntry("failure", "scorer_down").containsEntry("lease_token", null)
                .containsEntry("lease_until", null).containsEntry("attempt_count", 1);
        assertThat(jdbc.queryForMap("SELECT status,failure FROM reading_pronunciation_reports WHERE id=?", closed))
                .containsEntry("status", "failed").containsEntry("failure", "bad_audio");
        assertThat(instant("SELECT updated_at FROM reading_pronunciation_reports WHERE id=?", closed)).isEqualTo(now.plusSeconds(4));
    }

    @Test
    @DisplayName("lines: 그 회차의 녹음을 대본 순서로 낸다. 글은 읽는 글(speech)이 있으면 말 표시를 빈칸으로 바꾼 것이고 없으면 원문이다. 다른 회차의 녹음은 없다")
    void linesReadsTheSessionsRecordingsInScriptOrder() {
        UUID first = line(script, 1, "dialogue", nina, "안녕");
        UUID second = line(script, 2, "dialogue", nina, "Hello 니나");
        jdbc.update("UPDATE script_lines SET speech='⟦en⟧Hello⟦ko⟧니나' WHERE id=?", second);
        UUID session = session(owner, script, first, second, nina);
        UUID other = session(owner, script, first, second, nina);
        recording(owner, session, second, 1, "reading/second.m4a");
        recording(owner, session, first, 1, "reading/first.m4a");
        recording(owner, other, first, 1, "reading/other.m4a");
        jdbc.update("UPDATE reading_recordings SET transcript='안녕' WHERE object_key='reading/first.m4a'");

        assertThat(reports.lines(session)).containsExactly(
                new LineSource(1, "안녕", "안녕", "reading/first.m4a", "audio/mp4", 1200),
                new LineSource(2, " Hello 니나", null, "reading/second.m4a", "audio/mp4", 1200));
        assertThat(reports.lines(UUID.randomUUID())).isEmpty();
    }

    @Test
    @DisplayName("포트 메서드마다 나가는 문장: 청하기는 회차 읽기·넣기·보고서 읽기, 집기는 시한 지난 것 닫기·SKIP LOCKED 로 잠가 읽기·임대 적기다. 집을 것이 없으면 임대를 적지 않는다. 완료·실패·줄 읽기는 한 문장이다")
    void eachPortMethodSendsTheseStatements() {
        UUID done = completed(true);
        String update = "update reading_pronunciation_reports";

        assertThat(statementsOf(() -> reports.findOrEnqueue(owner, done, now))).containsExactly(
                "select reading_sessions", "insert reading_pronunciation_reports on conflict",
                "select reading_pronunciation_reports");
        assertThat(statementsOf(() -> reports.findOrEnqueue(owner, UUID.randomUUID(), now)))
                .containsExactly("select reading_sessions");
        UUID token = UUID.randomUUID();
        List<String> claim = statementsOf(() -> reports.claimNext(token, LEASE, 3, now));
        String lockNext = "select reading_pronunciation_reports for update skip locked";
        assertThat(claim).as("잠가 읽은 행에 임대를 적는다").containsExactly(update, lockNext, update);
        assertThat(statementsOf(() -> reports.claimNext(UUID.randomUUID(), LEASE, 3, now))).as("집을 것이 없을 때")
                .containsExactly(update, lockNext);
        UUID report = jdbc.queryForObject("SELECT id FROM reading_pronunciation_reports", UUID.class);
        assertThat(statementsOf(() -> reports.fail(report, UUID.randomUUID(), "x", true, now))).containsExactly(update);
        assertThat(statementsOf(() -> reports.complete(report, token, "done", "m", PronunciationRules.build(List.of()), now)))
                .containsExactly(update);
        assertThat(statementsOf(() -> reports.lines(done))).containsExactly("select reading_recordings");
    }

    /** 대사 한 줄짜리 회차. */
    private UUID completed(boolean completed) {
        UUID line = line(script, jdbc.queryForObject("SELECT count(*)+1 FROM script_lines", Integer.class), "dialogue", nina, "안녕");
        UUID session = session(owner, script, line, line, nina);
        if (completed) {
            jdbc.update("UPDATE reading_sessions SET status='completed', current_line_id=NULL WHERE id=?", session);
        }
        return session;
    }

    /** 끝난 회차의 queued 보고서. */
    private UUID report(Instant createdAt) {
        UUID session = completed(true);
        reports.findOrEnqueue(owner, session, createdAt);
        return jdbc.queryForObject("SELECT id FROM reading_pronunciation_reports WHERE reading_session_id=?", UUID.class, session);
    }

    private UUID sessionOf(UUID report) {
        return jdbc.queryForObject("SELECT reading_session_id FROM reading_pronunciation_reports WHERE id=?", UUID.class, report);
    }

    private String statusOf(UUID report) {
        return jdbc.queryForObject("SELECT status FROM reading_pronunciation_reports WHERE id=?", String.class, report);
    }
}
