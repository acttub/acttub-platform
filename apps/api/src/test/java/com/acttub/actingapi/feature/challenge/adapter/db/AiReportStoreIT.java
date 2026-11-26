package com.acttub.actingapi.feature.challenge.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.challenge.app.AiReportRepository;
import com.acttub.actingapi.feature.challenge.app.AiReportRepository.Comparison;
import com.acttub.actingapi.feature.challenge.app.AiReportRepository.Evidence;
import com.acttub.actingapi.feature.challenge.app.AiReportRepository.Report;
import com.acttub.actingapi.feature.challenge.app.AiReportRepository.Requested;
import com.acttub.actingapi.feature.challenge.app.AiReportRepository.Result;
import com.acttub.actingapi.feature.challenge.app.EntryRepository;
import com.acttub.actingapi.platform.ledger.AiJobLedger;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 챌린지 AI 리포트의 저장소({@code AiReportRepository})를 고정한다. 요청에서 워커를 거쳐 결과가 나오는 흐름, 하루 한도, 표본
 * 조건, 실패와 재시도는 {@code ChallengeAiReportIT} 가 HTTP 와 워커로 본다. 여기서는 행에 적히는 값, 저장되는 JSON, 다시 요청할 때
 * 같은 행을 덮는 것, 잠금의 세기와 순서, 같은 참여작의 두 요청과 저장·지우기가 겹칠 때, 나가는 문장을 본다.
 */
@ChallengeStoreTest
class AiReportStoreIT {

    private static final String KIND = "challenge_report";

    @Autowired
    ChallengeStoreFixture db;

    @Autowired
    AiReportRepository reports;

    @Autowired
    AiJobLedger ledger;

    @Autowired
    EntryRepository entries;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");
    private UUID owner;
    private UUID challenge;
    private UUID entry;

    @BeforeEach
    void setUp() {
        db.reset();
        owner = db.member("요청자");
        challenge = db.challenge(now.minus(Duration.ofDays(1)), now.plus(Duration.ofDays(6)));
        entry = db.entry(challenge, owner, now.minus(Duration.ofHours(1)));
    }

    // ---- 요청 ----

    @Test
    @DisplayName("request: 작업 하나와 리포트 행 하나를 만든다. 적는 값: pending·형식 버전·시도 0·요청 시각(마이크로초 반올림). 결과 칸은 비어 있다")
    void requestCreatesAJobAndAReportRow() {
        UUID request = UUID.randomUUID();
        Instant precise = now.plusNanos(123_456_789);

        Requested requested = reports.request(owner, entry, request, "a".repeat(64), precise);

        Instant rounded = now.plusNanos(123_457_000);
        assertThat(requested.created()).isTrue();
        assertThat(requested.report()).isEqualTo(new Report(entry, "pending", List.of(), List.of(), List.of(), null, 0, 0, rounded, null));
        Map<String, Object> job = db.jdbc.queryForMap("SELECT * FROM ai_jobs");
        assertThat(job).containsEntry("user_id", owner).containsEntry("kind", KIND).containsEntry("target_id", entry)
                .containsEntry("request_id", request).containsEntry("status", "pending").containsEntry("attempt_count", 0);
        assertThat(db.jdbc.queryForMap("SELECT entry_id,user_id,job_id,status,format_version,attempt_count,model,purged_at,completed_at,"
                + "result IS NULL AS empty FROM entry_ai_reports"))
                .containsEntry("entry_id", entry).containsEntry("user_id", owner).containsEntry("job_id", job.get("id"))
                .containsEntry("status", "pending").containsEntry("format_version", 1).containsEntry("attempt_count", 0)
                .containsEntry("model", null).containsEntry("purged_at", null).containsEntry("completed_at", null)
                .containsEntry("empty", true);
        assertThat(db.instant("SELECT requested_at FROM entry_ai_reports")).isEqualTo(rounded);
    }

    @Test
    @DisplayName("request: 같은 요청의 재전송과 만드는 중·끝난 리포트는 새로 만들지 않는다. 다른 지문의 재전송은 422, 남의 참여작·지운 참여작은 404, 영상이 없으면 422 다")
    void requestReturnsTheRunningOrFinishedReport() {
        UUID request = UUID.randomUUID();
        reports.request(owner, entry, request, "a".repeat(64), now);

        assertThat(reports.request(owner, entry, request, "a".repeat(64), now.plusSeconds(1)).created()).isFalse();
        assertThat(reports.request(owner, entry, UUID.randomUUID(), "b".repeat(64), now.plusSeconds(2)).created())
                .as("만드는 중이다").isFalse();
        assertRefused(() -> reports.request(owner, entry, request, "c".repeat(64), now), 422, "request_fingerprint_mismatch");
        UUID stranger = db.member("남");
        assertRefused(() -> reports.request(stranger, entry, UUID.randomUUID(), "a".repeat(64), now), 404, "entry_not_found");
        UUID purged = db.entry(challenge, owner, now.minus(Duration.ofHours(2)));
        db.jdbc.update("UPDATE videos SET purged_at=now() WHERE id=(SELECT video_id FROM challenge_entries WHERE id=?)", purged);
        assertRefused(() -> reports.request(owner, purged, UUID.randomUUID(), "a".repeat(64), now), 422, "video_not_ready");
        assertThat(db.count("ai_jobs")).isEqualTo(1);
        assertThat(db.count("entry_ai_reports")).isEqualTo(1);
        assertThat(db.instant("SELECT requested_at FROM entry_ai_reports")).isEqualTo(now);
    }

    @Test
    @DisplayName("실패한 리포트를 다시 요청하면 같은 행을 새 작업으로 덮는다 — pending·시도 0·결과와 모델과 끝난 시각을 비우고 요청 시각을 새로 적는다")
    void requestingAgainAfterAFailureReusesTheRow() {
        reports.request(owner, entry, UUID.randomUUID(), "a".repeat(64), now);
        UUID row = db.jdbc.queryForObject("SELECT id FROM entry_ai_reports", UUID.class);
        UUID firstJob = db.jdbc.queryForObject("SELECT job_id FROM entry_ai_reports", UUID.class);
        db.jdbc.update("""
                UPDATE entry_ai_reports SET status='failed',attempt_count=3,model='old-model',completed_at=now(),
                    result='{"observations":[]}'::jsonb,format_version=0
                """);

        Instant later = now.plusSeconds(600);
        Requested again = reports.request(owner, entry, UUID.randomUUID(), "b".repeat(64), later);

        assertThat(again.created()).isTrue();
        assertThat(again.report().status()).isEqualTo("pending");
        Map<String, Object> report = db.jdbc.queryForMap("SELECT *, result IS NULL AS empty FROM entry_ai_reports");
        assertThat(report).containsEntry("id", row).containsEntry("status", "pending").containsEntry("attempt_count", 0)
                .containsEntry("model", null).containsEntry("completed_at", null).containsEntry("empty", true)
                .containsEntry("format_version", 1);
        assertThat(report.get("job_id")).isNotEqualTo(firstJob);
        assertThat(db.instant("SELECT requested_at FROM entry_ai_reports")).isEqualTo(later);
        assertThat(db.count("ai_jobs")).isEqualTo(2);
    }

    @Test
    @DisplayName("같은 참여작의 리포트를 두 요청이 함께 청하면 하나만 작업을 만들고 다른 하나는 그 리포트를 받는다")
    void twoRequestsForTheSameEntry() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 10; round++) {
                UUID target = db.entry(challenge, db.member("요청자 " + round), now.minus(Duration.ofHours(1)));
                UUID requester = db.jdbc.queryForObject("SELECT user_id FROM challenge_entries WHERE id=?", UUID.class, target);
                CountDownLatch start = new CountDownLatch(1);
                Callable<Requested> request = () -> {
                    start.await();
                    return reports.request(requester, target, UUID.randomUUID(), "a".repeat(64), now);
                };
                Future<Requested> first = pool.submit(request);
                Future<Requested> second = pool.submit(request);
                start.countDown();

                assertThat(List.of(first.get(20, TimeUnit.SECONDS).created(), second.get(20, TimeUnit.SECONDS).created()))
                        .as("round %d", round).containsExactlyInAnyOrder(true, false);
                assertThat(db.jdbc.queryForObject("SELECT count(*) FROM ai_jobs WHERE target_id=?", Integer.class, target))
                        .as("round %d", round).isEqualTo(1);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    // ---- 조회 ----

    @Test
    @DisplayName("find: 리포트가 없거나, 남의 것이거나, 참여작을 지웠으면 404 ai_report_not_found 다")
    void findOnlyReturnsTheOwnersLiveReport() {
        assertRefused(() -> reports.find(owner, entry), 404, "ai_report_not_found");
        reports.request(owner, entry, UUID.randomUUID(), "a".repeat(64), now);
        assertThat(reports.find(owner, entry).status()).isEqualTo("pending");
        assertRefused(() -> reports.find(db.member("남"), entry), 404, "ai_report_not_found");
        db.jdbc.update("UPDATE challenge_entries SET status='deleted',deleted_at=now(),video_id=NULL WHERE id=?", entry);
        assertRefused(() -> reports.find(owner, entry), 404, "ai_report_not_found");
    }

    // ---- 저장 ----

    @Test
    @DisplayName("complete: 관찰·견주기·한계·제안·표본을 JSON 으로 저장하고 ready 로 바꾼다. 조건을 잃은 표본과 그것에 기댄 견주기는 뺀다. 작업은 성공으로 닫고 완료 알림을 남긴다")
    void completeStoresTheResultAsJson() {
        UUID keptSample = db.entry(challenge, db.member("표본 1"), now.minus(Duration.ofHours(3)));
        UUID lostSample = db.entry(challenge, db.member("표본 2"), now.minus(Duration.ofHours(2)));
        db.jdbc.update("UPDATE challenge_entries SET visibility='private' WHERE id=?", lostSample);
        reports.request(owner, entry, UUID.randomUUID(), "a".repeat(64), now);
        UUID lease = UUID.randomUUID();
        AiJobLedger.Claimed job = ledger.claimNext(KIND, lease, Duration.ofMinutes(10), now.plusSeconds(1));
        Result result = new Result(
                List.of(new Evidence(0, 900, "첫 문장 전에 \"멈춘다\" 😀"), new Evidence(1_000, 2_500, "시선이 아래로 간다")),
                List.of(new Comparison("다른 참여작들은 더 빠르다", List.of(keptSample)),
                        new Comparison("조건을 잃은 표본에 기댄 문장", List.of(keptSample, lostSample))),
                List.of("소리가 작아 일부는 들리지 않았다"), null, List.of(keptSample, lostSample));
        Instant done = now.plusSeconds(30).plusNanos(123_456_789);

        assertThat(reports.complete(job.id(), lease, entry, result, "model-x", done)).isTrue();

        assertThat(db.jdbc.queryForObject("SELECT result::text FROM entry_ai_reports", String.class)).isEqualTo(("""
                {"limits": ["소리가 작아 일부는 들리지 않았다"], "samples": ["%1$s"], "suggestion": null, \
                "comparisons": [{"text": "다른 참여작들은 더 빠르다", "samples": ["%1$s"]}], \
                "observations": [{"text": "첫 문장 전에 \\"멈춘다\\" 😀", "end_ms": 900, "start_ms": 0}, \
                {"text": "시선이 아래로 간다", "end_ms": 2500, "start_ms": 1000}]}""").formatted(keptSample));
        assertThat(db.jdbc.queryForMap("SELECT status,model,attempt_count FROM entry_ai_reports"))
                .containsEntry("status", "ready").containsEntry("model", "model-x").containsEntry("attempt_count", 1);
        Instant rounded = now.plusSeconds(30).plusNanos(123_457_000);
        assertThat(db.instant("SELECT completed_at FROM entry_ai_reports")).isEqualTo(rounded);
        assertThat(db.jdbc.queryForObject("SELECT status FROM ai_jobs", String.class)).isEqualTo("succeeded");
        assertThat(db.jdbc.queryForMap("SELECT kind,entry_id,actor_user_id,event_key FROM notifications WHERE user_id=?", owner))
                .containsEntry("kind", "entry_ai_report_ready").containsEntry("entry_id", entry)
                .containsEntry("actor_user_id", null).containsEntry("event_key", "ai_report:" + job.id());

        assertThat(reports.find(owner, entry)).isEqualTo(new Report(entry, "ready",
                List.of(new Evidence(0, 900, "첫 문장 전에 \"멈춘다\" 😀"), new Evidence(1_000, 2_500, "시선이 아래로 간다")),
                List.of("다른 참여작들은 더 빠르다"), List.of("소리가 작아 일부는 들리지 않았다"), null, 1, 1, now, rounded));
        db.jdbc.update("UPDATE challenge_entries SET status='hidden_by_report' WHERE id=?", keptSample);
        Report afterLoss = reports.find(owner, entry);
        assertThat(afterLoss.comparisons()).as("조회 때 조건을 다시 본다").isEmpty();
        assertThat(afterLoss.sampleCount()).isZero();
    }

    @Test
    @DisplayName("complete: 제안이 있으면 그대로 저장하고 읽는다. 표본이 없으면 빈 목록이다")
    void completeKeepsTheSuggestion() {
        reports.request(owner, entry, UUID.randomUUID(), "a".repeat(64), now);
        UUID lease = UUID.randomUUID();
        AiJobLedger.Claimed job = ledger.claimNext(KIND, lease, Duration.ofMinutes(10), now);

        reports.complete(job.id(), lease, entry, new Result(List.of(), List.of(), List.of(), "숨을 한 번 고르고 시작해 보세요", List.of()),
                "model", now);

        assertThat(db.jdbc.queryForObject("SELECT result::text FROM entry_ai_reports", String.class)).isEqualTo(
                "{\"limits\": [], \"samples\": [], \"suggestion\": \"숨을 한 번 고르고 시작해 보세요\", \"comparisons\": [], \"observations\": []}");
        assertThat(reports.find(owner, entry).suggestion()).isEqualTo("숨을 한 번 고르고 시작해 보세요");
    }

    @Test
    @DisplayName("complete: 만드는 사이 참여작을 지웠거나 계정이 닫혔거나 다른 생성으로 바뀌었으면 저장하지 않고 작업을 cancelled 로 닫는다")
    void completeIsCancelledWhenTheTargetIsGone() {
        Result result = new Result(List.of(new Evidence(0, 1, "관찰")), List.of(), List.of(), null, List.of());
        String[] changes = {
            "UPDATE challenge_entries SET status='deleted',deleted_at=now(),video_id=NULL WHERE id=?",
            "UPDATE users SET status='deactivated' WHERE id=(SELECT user_id FROM challenge_entries WHERE id=?)",
            "UPDATE entry_ai_reports SET status='failed' WHERE entry_id=?",
            "UPDATE entry_ai_reports SET purged_at=now() WHERE entry_id=?",
        };
        for (String change : changes) {
            setUp();
            reports.request(owner, entry, UUID.randomUUID(), "a".repeat(64), now);
            UUID lease = UUID.randomUUID();
            AiJobLedger.Claimed job = ledger.claimNext(KIND, lease, Duration.ofMinutes(10), now);
            db.jdbc.update(change, entry);

            assertThat(reports.complete(job.id(), lease, entry, result, "model", now)).as(change).isFalse();

            assertThat(db.jdbc.queryForObject("SELECT result IS NULL AND completed_at IS NULL FROM entry_ai_reports", Boolean.class))
                    .as(change).isTrue();
            assertThat(db.jdbc.queryForObject("SELECT status || '/' || failure_reason FROM ai_jobs", String.class))
                    .as(change).isEqualTo("failed/cancelled");
            assertThat(db.count("notifications")).as(change).isZero();
        }
    }

    @Test
    @DisplayName("attemptFailed: 다시 돌릴 실패는 시도 수만 적고 작업을 대기로 돌린다. 마지막 실패는 리포트와 작업을 failed 로 닫는다. 다른 생성의 것이면 리포트를 건드리지 않는다")
    void attemptFailedCountsOrCloses() {
        reports.request(owner, entry, UUID.randomUUID(), "a".repeat(64), now);
        UUID lease = UUID.randomUUID();
        AiJobLedger.Claimed job = ledger.claimNext(KIND, lease, Duration.ofMinutes(10), now);

        reports.attemptFailed(job.id(), lease, entry, 1, false, "model_error", now);
        assertThat(db.jdbc.queryForMap("SELECT status,attempt_count FROM entry_ai_reports"))
                .containsEntry("status", "pending").containsEntry("attempt_count", 1);
        assertThat(db.jdbc.queryForObject("SELECT status FROM ai_jobs", String.class)).isEqualTo("pending");

        UUID second = UUID.randomUUID();
        ledger.claimNext(KIND, second, Duration.ofMinutes(10), now);
        db.jdbc.update("UPDATE entry_ai_reports SET status='ready',result='{}'::jsonb");
        reports.attemptFailed(job.id(), second, entry, 2, false, "model_error", now);
        assertThat(db.jdbc.queryForMap("SELECT status,attempt_count FROM entry_ai_reports"))
                .as("pending 이 아니면 그대로").containsEntry("status", "ready").containsEntry("attempt_count", 1);
        db.jdbc.update("UPDATE entry_ai_reports SET status='pending',result=NULL");

        UUID third = UUID.randomUUID();
        ledger.claimNext(KIND, third, Duration.ofMinutes(10), now);
        reports.attemptFailed(job.id(), third, entry, 3, true, "parse", now);
        assertThat(db.jdbc.queryForMap("SELECT status,attempt_count FROM entry_ai_reports"))
                .containsEntry("status", "failed").containsEntry("attempt_count", 3);
        assertThat(db.jdbc.queryForObject("SELECT status || '/' || failure_reason FROM ai_jobs", String.class))
                .isEqualTo("failed/parse");
    }

    // ---- 잠금과 경합 ----

    @Test
    @DisplayName("request 는 참여작 행, 이어서 리포트 행을 FOR UPDATE 로 잡는다 — 바깥 연결의 FOR KEY SHARE 뒤에서 차례로 기다린다")
    void requestLocksTheEntryThenTheReport() throws Exception {
        reports.request(owner, entry, UUID.randomUUID(), "a".repeat(64), now);
        db.jdbc.update("UPDATE entry_ai_reports SET status='failed'");
        UUID report = db.jdbc.queryForObject("SELECT id FROM entry_ai_reports", UUID.class);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = db.probe()) {
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenge_entries WHERE id=? FOR KEY SHARE", entry);
            Future<Requested> onEntry = pool.submit(() -> reports.request(owner, entry, UUID.randomUUID(), "a".repeat(64), now));
            String waitingOnEntry = db.awaitWaiting("from challenge_entries");
            assertThat(db.locked("entry_ai_reports", report)).isFalse();
            probe.rollback();
            assertThat(onEntry.get(20, TimeUnit.SECONDS).created()).isTrue();

            db.jdbc.update("UPDATE entry_ai_reports SET status='failed'");
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM entry_ai_reports WHERE id=? FOR KEY SHARE", report);
            Future<Requested> onReport = pool.submit(() -> reports.request(owner, entry, UUID.randomUUID(), "a".repeat(64), now));
            String waitingOnReport = db.awaitWaiting("from entry_ai_reports");
            assertThat(db.locked("challenge_entries", entry)).isTrue();
            probe.rollback();
            assertThat(onReport.get(20, TimeUnit.SECONDS).created()).isTrue();

            assertThat(waitingOnEntry.toLowerCase()).contains("for update").doesNotContain("no key");
            assertThat(waitingOnReport.toLowerCase()).contains("for update").doesNotContain("no key");
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("참여작 지우기가 먼저 잡으면 결과 저장은 참여작 행에서 기다렸다가 저장하지 않고 작업을 닫는다 — 지운 참여작에 결과가 남지 않는다")
    void completeBehindADeleteStoresNothing() throws Exception {
        reports.request(owner, entry, UUID.randomUUID(), "a".repeat(64), now);
        UUID lease = UUID.randomUUID();
        AiJobLedger.Claimed job = ledger.claimNext(KIND, lease, Duration.ofMinutes(10), now);
        CountDownLatch deleted = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> deleting = pool.submit(() -> db.inTransaction(() -> {
                entries.delete(owner, entry, now);
                deleted.countDown();
                ChallengeStoreFixture.await(release);
            }));
            ChallengeStoreFixture.await(deleted);
            Future<Boolean> completing = pool.submit(() -> {
                try {
                    return reports.complete(job.id(), lease, entry,
                            new Result(List.of(new Evidence(0, 1, "관찰")), List.of(), List.of(), null, List.of()), "model", now);
                } catch (RuntimeException closed) {
                    return null;
                }
            });
            String waiting = db.awaitWaiting("from challenge_entries");
            release.countDown();
            deleting.get(20, TimeUnit.SECONDS);
            completing.get(20, TimeUnit.SECONDS);

            assertThat(waiting.toLowerCase()).contains("for update").doesNotContain("no key");
        } finally {
            pool.shutdownNow();
        }
        assertThat(db.jdbc.queryForObject("SELECT result IS NULL AND purged_at IS NOT NULL FROM entry_ai_reports", Boolean.class))
                .isTrue();
        assertThat(db.jdbc.queryForObject("SELECT status || '/' || failure_reason FROM ai_jobs", String.class))
                .isEqualTo("failed/cancelled");
    }

    // ---- 문장 ----

    @Test
    @DisplayName("나가는 문장: request 는 사람 → 재전송 확인 → 참여작 잠금 → 리포트 잠금 → 하루 수 → 작업 넣기 → 리포트 넣기(겹치면 덮기) → 읽기")
    void statements() {
        UUID request = UUID.randomUUID();
        String find = "select entry_ai_reports";

        assertThat(db.statementsOf(() -> reports.request(owner, entry, request, "a".repeat(64), now))).containsExactly(
                "select users for update", "select ai_jobs", "select challenge_entries for update",
                "select entry_ai_reports for update", "count ai_jobs", "insert ai_jobs", "insert entry_ai_reports on conflict", find);
        assertThat(db.statementsOf(() -> reports.request(owner, entry, request, "a".repeat(64), now))).as("재전송")
                .containsExactly("select users for update", "select ai_jobs", find);
        assertThat(db.statementsOf(() -> reports.request(owner, entry, UUID.randomUUID(), "a".repeat(64), now))).as("만드는 중")
                .containsExactly("select users for update", "select ai_jobs", "select challenge_entries for update",
                        "select entry_ai_reports for update", find);
        assertThat(db.statementsOf(() -> reports.find(owner, entry))).containsExactly(find);

        UUID lease = UUID.randomUUID();
        AiJobLedger.Claimed job = ledger.claimNext(KIND, lease, Duration.ofMinutes(10), now);
        List<String> failed = db.statementsOf(() -> reports.attemptFailed(job.id(), lease, entry, 1, false, "model_error", now));
        assertThat(failed.getFirst()).isEqualTo("update entry_ai_reports");
        UUID again = UUID.randomUUID();
        ledger.claimNext(KIND, again, Duration.ofMinutes(10), now);
        UUID sample = db.entry(challenge, db.member("표본"), now.minus(Duration.ofHours(2)));
        List<String> completed = db.statementsOf(() -> reports.complete(job.id(), again, entry,
                new Result(List.of(), List.of(), List.of(), null, List.of(sample)), "model", now));
        assertThat(completed.subList(0, 5)).containsExactly("select challenge_entries for update",
                "select entry_ai_reports for update", "select challenge_entries", "select ai_jobs", "update entry_ai_reports");
        assertThat(completed.subList(completed.size() - 3, completed.size()))
                .containsExactly("select notifications", "select user_profiles", "insert notifications on conflict");
        assertThat(db.statementsOf(() -> reports.find(owner, entry))).as("표본이 있으면 조건을 다시 본다")
                .containsExactly(find, "select challenge_entries");
    }

    private static void assertRefused(Runnable call, int status, String detail) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(ApiException.class, refused -> {
            assertThat(refused.status()).isEqualTo(status);
            assertThat(refused.getMessage()).isEqualTo(detail);
        });
    }
}
