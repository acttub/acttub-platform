package com.acttub.actingapi.feature.challenge.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.challenge.app.ReportRepository;
import com.acttub.actingapi.feature.challenge.app.ReportRepository.AdminReport;
import com.acttub.actingapi.feature.challenge.app.ReportRepository.Filed;
import com.acttub.actingapi.feature.challenge.app.ReportRepository.NewReport;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 신고와 운영 판정의 저장소({@code ReportRepository})를 고정한다. 신고가 숨기는 조건과 문턱, 하루 한도, 판정이 숨김을 푸는
 * 조건, 보관 기간의 HTTP 흐름은 {@code ChallengeReactionIT} 가 본다. 여기서는 신고 행에 적히는 값, 운영 화면이 받는 지금 상태,
 * 대상 행 잠금의 세기와 순서, 같은 대상의 신고와 판정이 겹칠 때, 나가는 문장을 본다.
 */
@ChallengeStoreTest
class EntryReportStoreIT {

    @Autowired
    ChallengeStoreFixture db;

    @Autowired
    ReportRepository reports;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");
    private UUID author;
    private UUID reporter;
    private UUID challenge;
    private UUID entry;
    /** 댓글을 다는 참여작. 신고하지 않아 계속 보인다 — 숨겨진 참여작의 댓글은 신고자에게 보이지 않는다. */
    private UUID commentedEntry;

    @BeforeEach
    void setUp() {
        db.reset();
        author = db.member("작성자");
        reporter = db.member("신고자");
        challenge = db.memberChallenge(author, now.minus(Duration.ofDays(1)), now.plus(Duration.ofDays(6)));
        entry = db.entry(challenge, author, now.minus(Duration.ofHours(1)));
        db.jdbc.update("UPDATE challenge_entries SET caption='참여작 설명',content_version=4 WHERE id=?", entry);
        commentedEntry = db.entry(challenge, author, now.minus(Duration.ofHours(5)));
    }

    // ---- 신고 ----

    @Test
    @DisplayName("file(참여작): 신고 행에 사유·메모·대상 버전·대상 글 사본·요청 id·지문·시각을 적고 사람 신고(user)로 남긴다. 검사 전 참여작은 신고 하나에 숨긴다")
    void filingAgainstAnEntry() {
        UUID request = UUID.randomUUID();
        Instant precise = now.plusNanos(123_456_789);

        Filed filed = reports.file(reporter, request, "a".repeat(64), new NewReport("entry", entry, "spam", "광고 같아요"), precise);

        Instant rounded = now.plusNanos(123_457_000);
        assertThat(filed.created()).isTrue();
        assertThat(filed.targetText()).isEqualTo("참여작 설명");
        assertThat(filed.receipt().status()).isEqualTo("received");
        Map<String, Object> row = db.jdbc.queryForMap("SELECT * FROM entry_reports");
        assertThat(row).containsEntry("id", filed.receipt().id()).containsEntry("target_type", "entry").containsEntry("target_id", entry)
                .containsEntry("reporter_id", reporter).containsEntry("source", "user").containsEntry("reason", "spam")
                .containsEntry("note", "광고 같아요").containsEntry("status", "received").containsEntry("target_version", 4)
                .containsEntry("target_text", "참여작 설명").containsEntry("request_id", request)
                .containsEntry("request_fingerprint", "a".repeat(64)).containsEntry("resolution", null);
        assertThat(db.instant("SELECT created_at FROM entry_reports")).isEqualTo(rounded);
        assertThat(db.jdbc.queryForObject("SELECT status FROM challenge_entries WHERE id=?", String.class, entry))
                .isEqualTo("hidden_by_report");
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", entry)).isEqualTo(rounded);
    }

    @Test
    @DisplayName("file: 같은 요청의 재전송과 같은 사람의 같은 대상 재신고는 앞의 접수를 돌려준다(새 행 없음, 대상 글 없음). 다른 지문의 재전송은 422, 자기 것은 422, 보이지 않는 대상은 404 다")
    void repeatedAndRefusedFilings() {
        UUID request = UUID.randomUUID();
        NewReport onChallenge = new NewReport("challenge", challenge, "inappropriate", null);
        Filed first = reports.file(reporter, request, "a".repeat(64), onChallenge, now);

        assertThat(reports.file(reporter, request, "a".repeat(64), onChallenge, now.plusSeconds(1)))
                .isEqualTo(new Filed(first.receipt(), false));
        assertThat(reports.file(reporter, UUID.randomUUID(), "b".repeat(64), onChallenge, now.plusSeconds(2)))
                .as("같은 대상 재신고").isEqualTo(new Filed(first.receipt(), false));
        assertRefused(() -> reports.file(reporter, request, "c".repeat(64), onChallenge, now), 422, "request_fingerprint_mismatch");
        assertThat(first.targetText()).isEqualTo("대사 " + challenge);
        assertThat(db.count("entry_reports")).isEqualTo(1);

        assertRefused(() -> reports.file(author, UUID.randomUUID(), "a".repeat(64), new NewReport("entry", entry, "spam", null), now),
                422, "self_report");
        assertRefused(() -> reports.file(author, UUID.randomUUID(), "a".repeat(64), onChallenge, now), 422, "self_report");
        UUID ownComment = comment(commentedEntry, author, "작성자의 댓글");
        assertRefused(() -> reports.file(author, UUID.randomUUID(), "a".repeat(64), new NewReport("comment", ownComment, "spam", null),
                now), 422, "self_report");
        assertRefused(() -> reports.file(reporter, UUID.randomUUID(), "a".repeat(64),
                new NewReport("entry", UUID.randomUUID(), "spam", null), now), 404, "entry_not_found");
        assertRefused(() -> reports.file(reporter, UUID.randomUUID(), "a".repeat(64),
                new NewReport("comment", UUID.randomUUID(), "spam", null), now), 404, "comment_not_found");
        assertRefused(() -> reports.file(reporter, UUID.randomUUID(), "a".repeat(64),
                new NewReport("challenge", UUID.randomUUID(), "spam", null), now), 404, "challenge_not_found");
        UUID notStarted = db.memberChallenge(author, now.plusNanos(1_000), now.plus(Duration.ofDays(7)));
        assertRefused(() -> reports.file(reporter, UUID.randomUUID(), "a".repeat(64),
                new NewReport("challenge", notStarted, "spam", null), now), 404, "challenge_not_found");
        assertThat(db.count("entry_reports")).isEqualTo(1);
    }

    @Test
    @DisplayName("file(댓글): 보이는 댓글을 그 자리에서 숨기고 본문 사본을 남긴다. 숨긴 댓글·지운 댓글·차단한 사람의 댓글은 404 다")
    void filingAgainstAComment() {
        UUID comment = comment(commentedEntry, author, "신고할 댓글");

        Filed filed = reports.file(reporter, UUID.randomUUID(), "a".repeat(64), new NewReport("comment", comment, "inappropriate", null), now);

        assertThat(filed.targetText()).isEqualTo("신고할 댓글");
        assertThat(db.jdbc.queryForMap("SELECT target_type,target_version,target_text,note FROM entry_reports WHERE id=?",
                filed.receipt().id())).containsEntry("target_type", "comment").containsEntry("target_version", 1)
                .containsEntry("target_text", "신고할 댓글").containsEntry("note", null);
        assertThat(db.jdbc.queryForObject("SELECT status FROM entry_comments WHERE id=?", String.class, comment)).isEqualTo("hidden");

        UUID second = db.member("둘째 신고자");
        assertRefused(() -> reports.file(second, UUID.randomUUID(), "a".repeat(64), new NewReport("comment", comment, "spam", null), now),
                404, "comment_not_found");
        UUID deleted = comment(commentedEntry, author, "지운 댓글");
        db.jdbc.update("UPDATE entry_comments SET body=NULL,deleted_at=now() WHERE id=?", deleted);
        assertRefused(() -> reports.file(second, UUID.randomUUID(), "a".repeat(64), new NewReport("comment", deleted, "spam", null), now),
                404, "comment_not_found");
        UUID blockedAuthor = db.member("차단한 사람");
        UUID fromBlocked = comment(commentedEntry, blockedAuthor, "차단한 사람의 댓글");
        db.jdbc.update("INSERT INTO user_blocks(id,blocker_id,blocked_id) VALUES (?,?,?)", UUID.randomUUID(), second, blockedAuthor);
        assertRefused(() -> reports.file(second, UUID.randomUUID(), "a".repeat(64), new NewReport("comment", fromBlocked, "spam", null),
                now), 404, "comment_not_found");
    }

    @Test
    @DisplayName("검사를 통과한 참여작은 서로 다른 두 사람의 신고가 모여야 숨기고, 챌린지는 서로 다른 세 사람이 모여야 검토로 올린다 — 함께 와도 같다")
    void thresholdsHoldUnderConcurrentFilings() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(3);
        try {
            for (int round = 0; round < 5; round++) {
                UUID passed = db.entry(challenge, author, now.minus(Duration.ofHours(2)));
                db.jdbc.update("UPDATE challenge_entries SET moderation_status='passed' WHERE id=?", passed);
                UUID target = db.memberChallenge(author, now.minus(Duration.ofDays(1)), now.plus(Duration.ofDays(6)));
                List<UUID> people = List.of(db.member("가"), db.member("나"), db.member("다"));
                CountDownLatch start = new CountDownLatch(1);
                List<Future<Filed>> filings = new ArrayList<>();
                for (UUID person : people.subList(0, 2)) {
                    filings.add(pool.submit(filing(start, person, new NewReport("entry", passed, "spam", null))));
                }
                start.countDown();
                for (Future<Filed> filing : filings) {
                    assertThat(filing.get(20, TimeUnit.SECONDS).created()).isTrue();
                }
                assertThat(db.jdbc.queryForObject("SELECT status FROM challenge_entries WHERE id=?", String.class, passed))
                        .as("round %d", round).isEqualTo("hidden_by_report");

                CountDownLatch together = new CountDownLatch(1);
                List<Future<Filed>> onChallenge = new ArrayList<>();
                for (UUID person : people) {
                    onChallenge.add(pool.submit(filing(together, person, new NewReport("challenge", target, "spam", null))));
                }
                together.countDown();
                for (Future<Filed> filing : onChallenge) {
                    filing.get(20, TimeUnit.SECONDS);
                }
                assertThat(db.jdbc.queryForObject("SELECT moderation FROM challenges WHERE id=?", String.class, target))
                        .as("round %d", round).isEqualTo("review");
            }
        } finally {
            pool.shutdownNow();
        }
        UUID onePassed = db.entry(challenge, author, now.minus(Duration.ofHours(3)));
        db.jdbc.update("UPDATE challenge_entries SET moderation_status='passed' WHERE id=?", onePassed);
        reports.file(reporter, UUID.randomUUID(), "a".repeat(64), new NewReport("entry", onePassed, "spam", null), now);
        assertThat(db.jdbc.queryForObject("SELECT status FROM challenge_entries WHERE id=?", String.class, onePassed))
                .as("한 사람의 신고로는 숨기지 않는다").isEqualTo("visible");
    }

    @Test
    @DisplayName("같은 사람이 같은 대상(검사를 통과해 신고 하나로는 숨겨지지 않는 참여작)을 두 요청으로 함께 신고하면 신고 행은 하나이고 뒤의 것은 앞의 접수를 받는다")
    void theSameReporterFilingTwiceAtOnce() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 10; round++) {
                UUID target = db.entry(challenge, author, now.minus(Duration.ofHours(2)));
                db.jdbc.update("UPDATE challenge_entries SET moderation_status='passed' WHERE id=?", target);
                CountDownLatch start = new CountDownLatch(1);
                Future<Filed> first = pool.submit(filing(start, reporter, new NewReport("entry", target, "spam", null)));
                Future<Filed> second = pool.submit(filing(start, reporter, new NewReport("entry", target, "spam", null)));
                start.countDown();
                List<Filed> results = List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));

                assertThat(results).as("round %d", round).extracting(Filed::created).containsExactlyInAnyOrder(true, false);
                assertThat(results.get(0).receipt()).isEqualTo(results.get(1).receipt());
                assertThat(db.jdbc.queryForObject("SELECT count(*) FROM entry_reports WHERE target_id=?", Integer.class, target))
                        .as("round %d", round).isEqualTo(1);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    // ---- 운영 화면 ----

    @Test
    @DisplayName("list: 상태별로 접수 순(시각, id)으로 50개씩 낸다. 신고마다 대상의 지금 버전·글·상태와 그 대상에 남은 접수 수를 싣는다")
    void listShowsTheCurrentStateOfEachTarget() {
        UUID comment = comment(commentedEntry, author, "댓글 본문");
        UUID onEntry = file(reporter, new NewReport("entry", entry, "spam", "메모"), now);
        UUID onComment = file(reporter, new NewReport("comment", comment, "inappropriate", null), now.plusSeconds(1));
        UUID onChallenge = file(reporter, new NewReport("challenge", challenge, "other", null), now.plusSeconds(2));
        UUID secondOnChallenge = file(db.member("둘째 신고자"), new NewReport("challenge", challenge, "spam", null), now.plusSeconds(3));
        db.jdbc.update("UPDATE challenge_entries SET caption='고친 설명',content_version=5 WHERE id=?", entry);

        List<AdminReport> received = reports.list("received", null).reports();

        assertThat(received).extracting(AdminReport::id).containsExactly(onEntry, onComment, onChallenge, secondOnChallenge);
        assertThat(received.get(0)).isEqualTo(new AdminReport(onEntry, "entry", entry, "spam", "메모", "received", null, null, null, null,
                4, 5, "참여작 설명", "고친 설명", "hidden_by_report", 1, now, now.plus(Duration.ofHours(24)), now.plus(Duration.ofHours(72))));
        assertThat(received.get(1)).extracting(AdminReport::currentVersion, AdminReport::reportedText, AdminReport::currentText,
                AdminReport::targetState, AdminReport::openReports).containsExactly(1, "댓글 본문", "댓글 본문", "hidden", 1L);
        assertThat(received.get(2)).extracting(AdminReport::currentVersion, AdminReport::currentText, AdminReport::targetState,
                AdminReport::openReports).containsExactly(1, "대사 " + challenge, "visible", 2L);
        assertThat(reports.list("reviewed", null).reports()).isEmpty();

        db.jdbc.update("UPDATE challenge_entries SET status='visible',visibility='private' WHERE id=?", entry);
        db.jdbc.update("UPDATE entry_comments SET body=NULL,deleted_at=now() WHERE id=?", comment);
        db.jdbc.update("UPDATE challenges SET deleted_at=now() WHERE id=?", challenge);
        List<AdminReport> changed = reports.list("received", null).reports();
        assertThat(changed).extracting(AdminReport::targetState).containsExactly("private", "deleted", "deleted", "deleted");
        assertThat(changed.get(1).currentText()).isNull();
        db.jdbc.update("UPDATE challenge_entries SET status='deleted',deleted_at=now(),video_id=NULL,caption=NULL WHERE id=?", entry);
        assertThat(reports.list("received", null).reports().getFirst()).extracting(AdminReport::targetState, AdminReport::currentText)
                .containsExactly("deleted", null);
    }

    @Test
    @DisplayName("list: 51번째부터는 다음 쪽이다 — 커서는 마지막 신고의 (시각, id) 뒤를 잇고, 같은 시각이면 id 순이다")
    void listPagesByTimeThenId() {
        db.jdbc.update("""
                INSERT INTO entry_reports(id,target_type,target_id,reporter_id,source,reason,status,target_version,request_id,
                    request_fingerprint,created_at)
                SELECT ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid,'entry',?,NULL,'ai','spam','received',1,
                    gen_random_uuid(),repeat('0',64),?
                FROM generate_series(1,53) n
                """, entry, ChallengeStoreFixture.utc(now));

        var first = reports.list("received", null);
        var second = reports.list("received", first.nextCursor());

        assertThat(first.reports()).hasSize(50);
        assertThat(first.reports().getFirst().id()).isEqualTo(id(1));
        assertThat(first.reports().getLast().id()).isEqualTo(id(50));
        assertThat(second.reports()).extracting(AdminReport::id).containsExactly(id(51), id(52), id(53));
        assertThat(second.nextCursor()).isNull();
        assertThat(first.reports().getFirst().openReports()).isEqualTo(53);
    }

    // ---- 판정 ----

    @Test
    @DisplayName("resolve: 판정·처리자·메모·시각을 적는다. dismissed 는 그 대상에 남은 접수가 없을 때만 숨김을 풀고 AI 판정을 통과로 바꾼다. 이미 처리한 신고는 422 다")
    void resolvingReleasesOnlyWhenNothingIsOpen() {
        UUID first = file(reporter, new NewReport("entry", entry, "spam", null), now);
        db.jdbc.update("UPDATE challenge_entries SET moderation_status='flagged' WHERE id=?", entry);
        UUID second = received("entry", entry, db.member("둘째 신고자"));
        UUID third = received("entry", entry, db.member("셋째 신고자"));
        Instant precise = now.plusSeconds(60).plusNanos(123_456_789);

        AdminReport resolved = reports.resolve(first, "dismissed", "ops@acttub.com", "문제 없음", precise);

        Instant rounded = now.plusSeconds(60).plusNanos(123_457_000);
        assertThat(resolved).extracting(AdminReport::status, AdminReport::resolution, AdminReport::reviewedBy,
                AdminReport::resolutionNote, AdminReport::reviewedAt, AdminReport::openReports, AdminReport::targetState)
                .containsExactly("reviewed", "dismissed", "ops@acttub.com", "문제 없음", rounded, 2L, "hidden_by_report");
        assertRefused(() -> reports.resolve(first, "dismissed", "ops", null, now), 422, "report_already_reviewed");
        assertRefused(() -> reports.resolve(UUID.randomUUID(), "dismissed", "ops", null, now), 404, "report_not_found");

        reports.resolve(second, "kept_hidden", "ops", null, now.plusSeconds(120));
        assertThat(entryState()).as("숨김 유지").isEqualTo("hidden_by_report/flagged");
        AdminReport released = reports.resolve(third, "dismissed", "ops", null, now.plusSeconds(180));
        assertThat(entryState()).as("남은 접수가 없으니 푼다").isEqualTo("visible/passed");
        assertThat(released.targetState()).isEqualTo("public");
        assertThat(released.openReports()).isZero();
    }

    @Test
    @DisplayName("resolve: 숨김 유지는 아직 보이는 참여작을 숨긴다. 댓글은 숨김을 풀거나 그대로 두고, 챌린지는 review 를 풀거나 그대로 둔다")
    void resolvingEachKindOfTarget() {
        db.jdbc.update("UPDATE challenge_entries SET moderation_status='passed' WHERE id=?", entry);
        UUID visibleEntryReport = file(reporter, new NewReport("entry", entry, "spam", null), now);
        assertThat(entryState()).isEqualTo("visible/passed");
        reports.resolve(visibleEntryReport, "kept_hidden", "ops", null, now);
        assertThat(entryState()).isEqualTo("hidden_by_report/passed");
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", entry)).isEqualTo(now);

        UUID comment = comment(commentedEntry, author, "댓글");
        UUID commentReport = file(reporter, new NewReport("comment", comment, "spam", null), now);
        reports.resolve(commentReport, "dismissed", "ops", null, now);
        assertThat(db.jdbc.queryForObject("SELECT status FROM entry_comments WHERE id=?", String.class, comment)).isEqualTo("visible");
        UUID keptComment = comment(commentedEntry, author, "숨길 댓글");
        reports.resolve(file(reporter, new NewReport("comment", keptComment, "spam", null), now), "kept_hidden", "ops", null, now);
        assertThat(db.jdbc.queryForObject("SELECT status FROM entry_comments WHERE id=?", String.class, keptComment)).isEqualTo("hidden");

        List<UUID> challengeReports = new ArrayList<>();
        for (UUID person : List.of(reporter, db.member("나"), db.member("다"))) {
            challengeReports.add(file(person, new NewReport("challenge", challenge, "spam", null), now));
        }
        assertThat(moderation()).isEqualTo("review");
        reports.resolve(challengeReports.get(0), "dismissed", "ops", null, now);
        assertThat(moderation()).as("접수가 남았다").isEqualTo("review");
        reports.resolve(challengeReports.get(1), "kept_hidden", "ops", null, now);
        reports.resolve(challengeReports.get(2), "kept_hidden", "ops", null, now);
        assertThat(moderation()).as("유지는 풀지 않는다").isEqualTo("review");
    }

    @Test
    @DisplayName("판정 뒤에는 기다리던 종료 순위를 확정해 본다 — 마지막 접수를 풀면 그 참여작이 순위에 든다")
    void resolvingSettlesTheChallenge() {
        UUID report = file(reporter, new NewReport("entry", entry, "spam", null), now);
        Instant afterDeadline = now.plus(Duration.ofDays(7));

        reports.resolve(report, "dismissed", "ops", null, afterDeadline);

        assertThat(db.jdbc.queryForMap("SELECT status,final_eligible,final_rank FROM challenge_entries WHERE id=?", entry))
                .containsEntry("status", "visible").containsEntry("final_eligible", true).containsEntry("final_rank", 1);
        assertThat(db.jdbc.queryForObject("SELECT ranking_state FROM challenges WHERE id=?", String.class, challenge)).isEqualTo("final");
    }

    // ---- 잠금과 경합 ----

    @Test
    @DisplayName("신고는 대상 행을 FOR UPDATE 로 잡는다(댓글·챌린지). 판정은 챌린지 → 참여작 → 신고 순서로 FOR UPDATE 를 잡는다")
    void lockStrengthAndOrder() throws Exception {
        UUID comment = comment(commentedEntry, author, "댓글");
        UUID report = file(reporter, new NewReport("entry", entry, "spam", null), now);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = db.probe()) {
            UUID second = db.member("둘째 신고자");
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM entry_comments WHERE id=? FOR KEY SHARE", comment);
            Future<Filed> onComment = pool.submit(() -> reports.file(second, UUID.randomUUID(), "a".repeat(64),
                    new NewReport("comment", comment, "spam", null), now));
            String waitingOnComment = db.awaitWaiting("from entry_comments");
            probe.rollback();
            onComment.get(20, TimeUnit.SECONDS);

            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenges WHERE id=? FOR KEY SHARE", challenge);
            Future<Filed> onChallenge = pool.submit(() -> reports.file(second, UUID.randomUUID(), "a".repeat(64),
                    new NewReport("challenge", challenge, "spam", null), now));
            String waitingOnChallenge = db.awaitWaiting("from challenges");
            assertThat(db.locked("users", second)).as("사람 행이 먼저다").isTrue();
            probe.rollback();
            onChallenge.get(20, TimeUnit.SECONDS);

            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenges WHERE id=? FOR KEY SHARE", challenge);
            Future<AdminReport> resolving = pool.submit(() -> reports.resolve(report, "dismissed", "ops", null, now));
            String resolveOnChallenge = db.awaitWaiting("from challenges");
            assertThat(db.locked("challenge_entries", entry)).isFalse();
            assertThat(db.locked("entry_reports", report)).isFalse();
            probe.rollback();
            resolving.get(20, TimeUnit.SECONDS);

            UUID another = file(db.member("셋째 신고자"), new NewReport("entry", entry, "spam", null), now);
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM entry_reports WHERE id=? FOR KEY SHARE", another);
            Future<AdminReport> onReport = pool.submit(() -> reports.resolve(another, "dismissed", "ops", null, now));
            String waitingOnReport = db.awaitWaiting("from entry_reports");
            assertThat(db.locked("challenges", challenge)).isTrue();
            assertThat(db.locked("challenge_entries", entry)).isTrue();
            probe.rollback();
            onReport.get(20, TimeUnit.SECONDS);

            for (String waiting : List.of(waitingOnComment, waitingOnChallenge, resolveOnChallenge, waitingOnReport)) {
                assertThat(waiting.toLowerCase()).contains("for update").doesNotContain("no key");
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("같은 신고를 두 운영자가 함께 판정하면 하나만 적용되고 다른 하나는 422 report_already_reviewed 다")
    void twoOperatorsResolvingTheSameReport() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 10; round++) {
                UUID target = db.entry(challenge, author, now.minus(Duration.ofHours(2)));
                UUID report = file(reporter, new NewReport("entry", target, "spam", null), now);
                CountDownLatch start = new CountDownLatch(1);
                List<Future<Object>> racing = new ArrayList<>();
                for (String resolution : List.of("dismissed", "kept_hidden")) {
                    racing.add(pool.submit(() -> {
                        start.await();
                        try {
                            return reports.resolve(report, resolution, "ops", null, now);
                        } catch (ApiException refused) {
                            return refused;
                        }
                    }));
                }
                start.countDown();
                List<Object> results = List.of(racing.get(0).get(20, TimeUnit.SECONDS), racing.get(1).get(20, TimeUnit.SECONDS));

                assertThat(results).as("round %d", round).filteredOn(AdminReport.class::isInstance).hasSize(1);
                assertThat(results).as("round %d", round).filteredOn(ApiException.class::isInstance).singleElement()
                        .satisfies(refused -> assertThat(((ApiException) refused).getMessage()).isEqualTo("report_already_reviewed"));
                String applied = ((AdminReport) results.stream().filter(AdminReport.class::isInstance).findFirst().orElseThrow()).resolution();
                assertThat(db.jdbc.queryForObject("SELECT status FROM challenge_entries WHERE id=?", String.class, target))
                        .as("round %d", round).isEqualTo("dismissed".equals(applied) ? "visible" : "hidden_by_report");
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("판정이 참여작을 잡고 있는 동안 온 새 신고는 기다렸다가 접수돼 다시 숨긴다 — 판정이 방금 푼 참여작에 접수가 남은 채 보이지 않는다")
    void aFilingBehindAResolutionHidesTheEntryAgain() throws Exception {
        UUID report = file(reporter, new NewReport("entry", entry, "spam", null), now);
        UUID second = db.member("둘째 신고자");
        CountDownLatch resolved = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> resolving = pool.submit(() -> db.inTransaction(() -> {
                reports.resolve(report, "dismissed", "ops", null, now);
                resolved.countDown();
                ChallengeStoreFixture.await(release);
            }));
            ChallengeStoreFixture.await(resolved);
            Future<Object> filing = pool.submit(() -> {
                try {
                    return reports.file(second, UUID.randomUUID(), "a".repeat(64), new NewReport("entry", entry, "spam", null), now);
                } catch (ApiException refused) {
                    return refused;
                }
            });
            db.awaitWaiting("from challenge_entries");
            release.countDown();
            resolving.get(20, TimeUnit.SECONDS);

            assertThat(filing.get(20, TimeUnit.SECONDS)).isInstanceOfSatisfying(Filed.class, filed -> assertThat(filed.created()).isTrue());
        } finally {
            pool.shutdownNow();
        }
        assertThat(db.jdbc.queryForObject("SELECT status FROM challenge_entries WHERE id=?", String.class, entry))
                .isEqualTo("hidden_by_report");
        assertThat(db.jdbc.queryForObject("SELECT count(*) FROM entry_reports WHERE status='received'", Integer.class)).isEqualTo(1);
    }

    // ---- 문장 ----

    @Test
    @DisplayName("나가는 문장: 신고는 재전송 확인(둘) → 대상 잠금 → 재전송 확인(둘)·하루 수 → 넣기 → 숨김. 판정은 신고 찾기 → 대상 잠금 → 신고 잠금 → 적기 → 남은 접수 → 풀기 → 정산 → 읽기")
    void statements() {
        List<String> prior = List.of("select entry_reports", "select entry_reports");
        List<String> guarded = List.of("select entry_reports", "select entry_reports", "count entry_reports");
        List<String> people = author.compareTo(reporter) < 0
                ? List.of("select users for share", "select users for update")
                : List.of("select users for update", "select users for share");
        List<String> lockEntry = List.of("select challenge_entries", people.get(0), people.get(1), "select challenges",
                "select challenge_entries for update", "select challenge_entries");

        UUID request = UUID.randomUUID();
        NewReport onEntry = new NewReport("entry", entry, "spam", null);
        assertThat(db.statementsOf(() -> reports.file(reporter, request, "a".repeat(64), onEntry, now))).containsExactlyElementsOf(
                concat(prior, lockEntry, guarded, List.of("insert entry_reports", "select challenge_entries", "update challenge_entries")));
        assertThat(db.statementsOf(() -> reports.file(reporter, request, "a".repeat(64), onEntry, now))).as("재전송")
                .containsExactly("select entry_reports");

        UUID comment = comment(commentedEntry, author, "댓글");
        assertThat(db.statementsOf(() -> reports.file(reporter, UUID.randomUUID(), "a".repeat(64),
                new NewReport("comment", comment, "spam", null), now))).containsExactlyElementsOf(concat(prior,
                List.of("select entry_comments", people.get(0), people.get(1), "select entry_comments for update", "select challenge_entries"),
                guarded, List.of("insert entry_reports", "update entry_comments")));
        assertThat(db.statementsOf(() -> reports.file(reporter, UUID.randomUUID(), "a".repeat(64),
                new NewReport("challenge", challenge, "spam", null), now))).containsExactlyElementsOf(concat(prior,
                List.of("select users for update", "select challenges for update"), guarded,
                List.of("insert entry_reports", "count entry_reports")));

        UUID entryReport = db.jdbc.queryForObject("SELECT id FROM entry_reports WHERE target_type='entry'", UUID.class);
        List<String> settle = List.of("select challenges for update");
        assertThat(db.statementsOf(() -> reports.resolve(entryReport, "dismissed", "ops", null, now))).containsExactlyElementsOf(concat(
                List.of("select entry_reports", "select challenge_entries"), settle,
                List.of("select challenge_entries for update", "select entry_reports for update", "update entry_reports",
                        "count entry_reports", "update challenge_entries"), settle, List.of("select entry_reports")));
        UUID commentReport = db.jdbc.queryForObject("SELECT id FROM entry_reports WHERE target_type='comment'", UUID.class);
        assertThat(db.statementsOf(() -> reports.resolve(commentReport, "kept_hidden", "ops", null, now))).containsExactly(
                "select entry_reports", "select entry_comments for update", "select entry_reports for update", "update entry_reports",
                "count entry_reports", "select entry_reports");
        UUID challengeReport = db.jdbc.queryForObject("SELECT id FROM entry_reports WHERE target_type='challenge'", UUID.class);
        assertThat(db.statementsOf(() -> reports.resolve(challengeReport, "dismissed", "ops", null, now))).containsExactlyElementsOf(concat(
                List.of("select entry_reports", "select challenges for update", "select entry_reports for update", "update entry_reports",
                        "count entry_reports", "update challenges"), settle, List.of("select entry_reports")));

        assertThat(db.statementsOf(() -> reports.list("received", null))).containsExactly("select entry_reports");
    }

    // ---- 도움 ----

    private UUID file(UUID by, NewReport report, Instant at) {
        return reports.file(by, UUID.randomUUID(), "a".repeat(64), report, at).receipt().id();
    }

    private Callable<Filed> filing(CountDownLatch start, UUID by, NewReport report) {
        return () -> {
            start.await();
            return reports.file(by, UUID.randomUUID(), "a".repeat(64), report, now);
        };
    }

    private UUID comment(UUID entryId, UUID by, String body) {
        UUID id = UUID.randomUUID();
        db.jdbc.update("""
                INSERT INTO entry_comments(id,entry_id,user_id,body,request_id,request_fingerprint) VALUES (?,?,?,?,?,?)
                """, id, entryId, by, body, UUID.randomUUID(), "0".repeat(64));
        return id;
    }

    /** 처리 전 신고 행 하나를 바로 넣는다 — 숨겨진 대상은 포트로 더 신고할 수 없다. */
    private UUID received(String type, UUID target, UUID by) {
        UUID id = UUID.randomUUID();
        db.jdbc.update("""
                INSERT INTO entry_reports(id,target_type,target_id,reporter_id,reason,status,target_version,request_id,request_fingerprint)
                VALUES (?,?,?,?,'spam','received',1,gen_random_uuid(),repeat('0',64))
                """, id, type, target, by);
        return id;
    }

    /** "<상태>/<AI 판정>". */
    private String entryState() {
        return db.jdbc.queryForObject("SELECT status || '/' || moderation_status FROM challenge_entries WHERE id=?", String.class, entry);
    }

    private String moderation() {
        return db.jdbc.queryForObject("SELECT moderation FROM challenges WHERE id=?", String.class, challenge);
    }

    @SafeVarargs
    private static List<String> concat(List<String>... parts) {
        return java.util.Arrays.stream(parts).flatMap(List::stream).toList();
    }

    private static UUID id(int n) {
        return UUID.fromString("00000000-0000-0000-0000-%012d".formatted(n));
    }

    private static void assertRefused(Runnable call, int status, String detail) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(ApiException.class, refused -> {
            assertThat(refused.status()).isEqualTo(status);
            assertThat(refused.getMessage()).isEqualTo(detail);
        });
    }
}
