package com.acttub.actingapi.feature.challenge.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.challenge.app.AiReportRepository.Video;
import com.acttub.actingapi.feature.challenge.app.EntryModerationRepository;
import com.acttub.actingapi.feature.challenge.app.EntryModerationRepository.Job;
import com.acttub.actingapi.feature.challenge.app.EntryModerationVerdict;
import com.acttub.actingapi.feature.challenge.app.EntryModerationVerdict.Decision;
import com.acttub.actingapi.feature.challenge.app.EntryRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 공개 참여작 AI 검사의 장부({@code EntryModerationRepository})를 고정한다. 검사 워커를 거친 흐름(숨김·확인 필요·실패가 운영 신고로
 * 오르고 운영이 푸는 것, 얼굴 여부 채우기)은 {@code ChallengeReactionIT} 가 본다. 여기서는 집는 순서와 건너뛰는 행, 상한에 닿은
 * 것 닫기, 판정이 적는 값, 집은 뒤 바뀐 참여작, 잠금의 세기, 판정과 캡션 고치기가 겹칠 때, 나가는 문장을 본다.
 */
@ChallengeStoreTest
class EntryModerationStoreIT {

    private static final int MAX = 3;

    @Autowired
    ChallengeStoreFixture db;

    @Autowired
    EntryModerationRepository moderation;

    @Autowired
    EntryRepository entries;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");
    private final Instant created = now.minus(Duration.ofHours(2));
    private UUID author;
    private UUID challenge;

    @BeforeEach
    void setUp() {
        db.reset();
        author = db.member("작성자");
        challenge = db.challenge(now.minus(Duration.ofDays(1)), now.plus(Duration.ofDays(6)));
    }

    // ---- 집기 ----

    @Test
    @DisplayName("claim: 검사 차례인 참여작을 만든 시각·id 순으로 하나 집어 시도 수를 올린다. 지운 것·닫힌 계정·파기된 영상은 집지 않고, 없으면 null 이다")
    void claimTakesTheOldestPendingEntry() {
        UUID newer = pending(db.entry(challenge, author, created.plusSeconds(10)));
        UUID older = pending(db.entry(challenge, author, created));
        db.jdbc.update("UPDATE challenge_entries SET caption='설명',content_version=4,moderation_attempts=1 WHERE id=?", older);
        UUID deleted = pending(db.entry(challenge, author, created.minusSeconds(30)));
        db.jdbc.update("UPDATE challenge_entries SET status='deleted',deleted_at=now(),video_id=NULL WHERE id=?", deleted);
        UUID closedAuthor = db.member("닫힌 계정");
        pending(db.entry(challenge, closedAuthor, created.minusSeconds(20)));
        db.jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", closedAuthor);
        UUID purged = pending(db.entry(challenge, author, created.minusSeconds(10)));
        db.jdbc.update("UPDATE videos SET purged_at=now() WHERE id=(SELECT video_id FROM challenge_entries WHERE id=?)", purged);
        db.entry(challenge, author, created.minusSeconds(5));

        Job first = moderation.claim(MAX, now);
        Job second = moderation.claim(MAX, now);

        UUID video = db.jdbc.queryForObject("SELECT video_id FROM challenge_entries WHERE id=?", UUID.class, older);
        assertThat(first).isEqualTo(new Job(older, 2, 4, new Video("videos/" + video, "video/mp4", 30_000), "대사 " + challenge, "설명"));
        assertThat(second.entryId()).as("같은 것을 다시 집는다 — 판정이 붙을 때까지 차례에 남는다").isEqualTo(older);
        assertThat(second.attempts()).isEqualTo(3);
        assertThat(attempts(newer)).isZero();
        assertThat(status(older)).as("집기만으로는 상태가 바뀌지 않는다").isEqualTo("pending");
    }

    @Test
    @DisplayName("claim: 상한에 닿은 채 남은 것을 한 번에 20개까지 실패로 닫고 운영 신고(AI)로 올린다. 영상은 보이게 둔다")
    void claimClosesExhaustedEntries() {
        UUID exhausted = pending(db.entry(challenge, author, created));
        db.jdbc.update("UPDATE challenge_entries SET moderation_attempts=3,caption='남은 설명',content_version=2 WHERE id=?", exhausted);
        UUID deletedExhausted = pending(db.entry(challenge, author, created.plusSeconds(1)));
        db.jdbc.update("UPDATE challenge_entries SET moderation_attempts=3,status='deleted',deleted_at=now(),video_id=NULL WHERE id=?",
                deletedExhausted);

        assertThat(moderation.claim(MAX, now)).isNull();

        assertThat(db.jdbc.queryForMap("SELECT status,moderation_status,moderation_attempts FROM challenge_entries WHERE id=?", exhausted))
                .containsEntry("status", "visible").containsEntry("moderation_status", "failed").containsEntry("moderation_attempts", 3);
        assertThat(db.instant("SELECT moderated_at FROM challenge_entries WHERE id=?", exhausted)).isEqualTo(now);
        Map<String, Object> report = db.jdbc.queryForMap("SELECT * FROM entry_reports WHERE target_id=?", exhausted);
        assertThat(report).containsEntry("target_type", "entry").containsEntry("reporter_id", null).containsEntry("source", "ai")
                .containsEntry("reason", "other").containsEntry("note", EntryModerationVerdict.failureNote())
                .containsEntry("status", "received").containsEntry("target_version", 2).containsEntry("target_text", "남은 설명")
                .containsEntry("resolution", null).containsEntry("reviewed_at", null);
        assertThat(((String) report.get("request_fingerprint"))).hasSize(64).matches("[0-9a-f]+");
        assertThat(db.instant("SELECT created_at FROM entry_reports WHERE target_id=?", exhausted)).isEqualTo(now);
        assertThat(status(deletedExhausted)).as("지운 것은 닫지 않는다").isEqualTo("pending");
        assertThat(db.count("entry_reports")).isEqualTo(1);

        for (int n = 1; n <= 21; n++) {
            UUID late = pending(db.entry(challenge, author, created.plusSeconds(60 + n)));
            db.jdbc.update("UPDATE challenge_entries SET moderation_attempts=5 WHERE id=?", late);
        }
        moderation.claim(MAX, now);
        assertThat(db.jdbc.queryForObject("SELECT count(*) FROM challenge_entries WHERE moderation_status='failed'", Integer.class))
                .as("한 번에 20개").isEqualTo(21);
        assertThat(db.jdbc.queryForObject("""
                SELECT moderation_status FROM challenge_entries WHERE moderation_attempts=5 ORDER BY created_at DESC,id DESC LIMIT 1
                """, String.class)).as("가장 나중 것이 남는다").isEqualTo("pending");
    }

    @Test
    @DisplayName("claim 은 다른 트랜잭션이 잡고 있는 행을 기다리지 않고 건너뛴다 — 상한에 닿은 것을 닫을 때도, 검사할 것을 집을 때도")
    void claimSkipsLockedRows() throws Exception {
        UUID exhausted = pending(db.entry(challenge, author, created));
        db.jdbc.update("UPDATE challenge_entries SET moderation_attempts=3 WHERE id=?", exhausted);
        UUID oldest = pending(db.entry(challenge, author, created.plusSeconds(1)));
        UUID next = pending(db.entry(challenge, author, created.plusSeconds(2)));
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = db.probe()) {
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenge_entries WHERE id IN (?,?) FOR UPDATE", exhausted, oldest);
            Job claimed = pool.submit(() -> moderation.claim(MAX, now)).get(20, TimeUnit.SECONDS);
            probe.rollback();

            assertThat(claimed.entryId()).isEqualTo(next);
            assertThat(status(exhausted)).as("잡힌 것은 닫지 않고 지나간다").isEqualTo("pending");
            assertThat(attempts(oldest)).isZero();
        } finally {
            pool.shutdownNow();
        }
        assertThat(moderation.claim(MAX, now).entryId()).isEqualTo(oldest);
        assertThat(status(exhausted)).isEqualTo("failed");
    }

    // ---- 판정 ----

    @Test
    @DisplayName("judged: 통과는 상태·모델·시각만 적는다. 얼굴 여부는 모델이 답한 값으로 적고, 답하지 않으면 이미 아는 값을 지우지 않는다")
    void passingVerdictsStoreTheStatusAndTheFace() {
        UUID entry = pending(db.entry(challenge, author, created));
        Instant updatedBefore = db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", entry);
        Instant precise = now.plusNanos(123_456_789);

        moderation.judged(moderation.claim(MAX, now), new EntryModerationVerdict(Decision.PASS, "none", null, true), "model-a", precise);

        assertThat(db.jdbc.queryForMap("SELECT status,moderation_status,moderation_model,face_visible FROM challenge_entries WHERE id=?",
                entry)).containsEntry("status", "visible").containsEntry("moderation_status", "passed")
                .containsEntry("moderation_model", "model-a").containsEntry("face_visible", true);
        assertThat(db.instant("SELECT moderated_at FROM challenge_entries WHERE id=?", entry)).isEqualTo(now.plusNanos(123_457_000));
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", entry)).as("통과는 고친 시각을 바꾸지 않는다")
                .isEqualTo(updatedBefore);
        assertThat(db.count("entry_reports")).isZero();

        pending(entry);
        moderation.judged(moderation.claim(MAX, now), new EntryModerationVerdict(Decision.PASS, "none", null, null), "model-b", now);
        assertThat(db.jdbc.queryForMap("SELECT moderation_model,face_visible FROM challenge_entries WHERE id=?", entry))
                .as("답하지 않으면 그대로").containsEntry("moderation_model", "model-b").containsEntry("face_visible", true);

        pending(entry);
        moderation.judged(moderation.claim(MAX, now), new EntryModerationVerdict(Decision.PASS, "none", null, false), "model-c", now);
        assertThat(db.jdbc.queryForObject("SELECT face_visible FROM challenge_entries WHERE id=?", Boolean.class, entry)).isFalse();
    }

    @Test
    @DisplayName("judged: 숨김은 보이던 참여작을 hidden_by_report 로 바꾸고 신고(AI)를 올린다. 확인 필요는 보이게 두고 신고만 올린다")
    void hideAndReviewVerdictsFileAnAiReport() {
        UUID hidden = pending(db.entry(challenge, author, created));
        db.jdbc.update("UPDATE challenge_entries SET caption='광고 문구',content_version=5 WHERE id=?", hidden);
        UUID reviewed = pending(db.entry(challenge, author, created.plusSeconds(1)));
        UUID alreadyHidden = pending(db.entry(challenge, author, created.plusSeconds(2)));

        EntryModerationVerdict hide = new EntryModerationVerdict(Decision.HIDE, "spam", "광고", null);
        moderation.judged(moderation.claim(MAX, now), hide, "model", now);
        EntryModerationVerdict review = new EntryModerationVerdict(Decision.REVIEW, "unrelated", "대사와 무관", null);
        moderation.judged(moderation.claim(MAX, now), review, "model", now);
        Job third = moderation.claim(MAX, now);
        db.jdbc.update("UPDATE challenge_entries SET status='hidden_by_report' WHERE id=?", alreadyHidden);
        Instant updatedBefore = db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", alreadyHidden);
        moderation.judged(third, hide, "model", now.plusSeconds(60));

        assertThat(db.jdbc.queryForMap("SELECT status,moderation_status FROM challenge_entries WHERE id=?", hidden))
                .containsEntry("status", "hidden_by_report").containsEntry("moderation_status", "flagged");
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", hidden)).isEqualTo(now);
        assertThat(db.jdbc.queryForMap("SELECT source,reason,note,target_version,target_text,status FROM entry_reports WHERE target_id=?",
                hidden)).containsEntry("source", "ai").containsEntry("reason", "spam").containsEntry("note", hide.reportNote())
                .containsEntry("target_version", 5).containsEntry("target_text", "광고 문구").containsEntry("status", "received");
        assertThat(db.jdbc.queryForMap("SELECT status,moderation_status FROM challenge_entries WHERE id=?", reviewed))
                .containsEntry("status", "visible").containsEntry("moderation_status", "review");
        assertThat(db.jdbc.queryForMap("SELECT reason,note,target_text FROM entry_reports WHERE target_id=?", reviewed))
                .containsEntry("reason", "other").containsEntry("note", review.reportNote()).containsEntry("target_text", null);
        assertThat(status(alreadyHidden)).isEqualTo("flagged");
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", alreadyHidden))
                .as("이미 숨겨진 것은 고친 시각을 다시 쓰지 않는다").isEqualTo(updatedBefore);
        assertThat(db.count("entry_reports")).isEqualTo(3);
    }

    @Test
    @DisplayName("집은 뒤 참여작이 바뀌었으면(다른 시도가 앞섰다·캡션이 바뀌었다·차례가 끝났다·지웠다) 판정과 실패 닫기는 아무것도 하지 않는다")
    void staleJobsDoNothing() {
        EntryModerationVerdict hide = new EntryModerationVerdict(Decision.HIDE, "spam", "광고", true);
        String[] changes = {
            "UPDATE challenge_entries SET moderation_attempts=moderation_attempts+1 WHERE id=?",
            "UPDATE challenge_entries SET content_version=content_version+1 WHERE id=?",
            "UPDATE challenge_entries SET moderation_status='passed' WHERE id=?",
            "UPDATE challenge_entries SET status='deleted',deleted_at=now(),video_id=NULL WHERE id=?",
        };
        for (String change : changes) {
            setUp();
            UUID entry = pending(db.entry(challenge, author, created));
            Job job = moderation.claim(MAX, now);
            db.jdbc.update(change, entry);
            // 배열 칸이 있어 행을 JSON 글자로 견준다.
            String before = db.jdbc.queryForObject("SELECT to_jsonb(e)::text FROM challenge_entries e WHERE id=?", String.class, entry);

            moderation.judged(job, hide, "model", now);
            moderation.fail(job, now);

            assertThat(db.jdbc.queryForObject("SELECT to_jsonb(e)::text FROM challenge_entries e WHERE id=?", String.class, entry))
                    .as(change).isEqualTo(before);
            assertThat(db.count("entry_reports")).as(change).isZero();
        }
        Job missing = new Job(UUID.randomUUID(), 1, 1, new Video("k", "video/mp4", 1), "대사", null);
        moderation.judged(missing, hide, "model", now);
        moderation.fail(missing, now);
        assertThat(db.count("entry_reports")).isZero();
    }

    @Test
    @DisplayName("fail: 집은 그대로면 실패로 닫고 운영 신고(AI)로 올린다. 영상은 보이게 둔다")
    void failClosesTheEntryAndFilesAReport() {
        UUID entry = pending(db.entry(challenge, author, created));

        moderation.fail(moderation.claim(MAX, now), now);

        assertThat(db.jdbc.queryForMap("SELECT status,moderation_status FROM challenge_entries WHERE id=?", entry))
                .containsEntry("status", "visible").containsEntry("moderation_status", "failed");
        assertThat(db.instant("SELECT moderated_at FROM challenge_entries WHERE id=?", entry)).isEqualTo(now);
        assertThat(db.jdbc.queryForMap("SELECT source,reason,note,target_version FROM entry_reports WHERE target_id=?", entry))
                .containsEntry("source", "ai").containsEntry("reason", "other")
                .containsEntry("note", EntryModerationVerdict.failureNote()).containsEntry("target_version", 1);
    }

    @Test
    @DisplayName("faceSeen: 얼굴 여부를 모를 때만 적는다. 이미 정해진 값은 바꾸지 않고 판정 칸은 건드리지 않는다")
    void faceSeenOnlyFillsAnUnknownFace() {
        UUID entry = db.entry(challenge, author, created);
        db.jdbc.update("UPDATE challenge_entries SET moderation_status='passed',moderation_model='old' WHERE id=?", entry);

        moderation.faceSeen(entry, false);
        moderation.faceSeen(entry, true);
        moderation.faceSeen(UUID.randomUUID(), true);

        assertThat(db.jdbc.queryForMap("SELECT face_visible,moderation_status,moderation_model FROM challenge_entries WHERE id=?", entry))
                .containsEntry("face_visible", false).containsEntry("moderation_status", "passed").containsEntry("moderation_model", "old");
    }

    // ---- 잠금과 경합 ----

    @Test
    @DisplayName("판정은 참여작 행을 FOR UPDATE 로 잡는다 — 바깥 연결의 FOR KEY SHARE 뒤에서 기다린다")
    void judgedLocksTheEntryForUpdate() throws Exception {
        UUID entry = pending(db.entry(challenge, author, created));
        Job job = moderation.claim(MAX, now);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = db.probe()) {
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenge_entries WHERE id=? FOR KEY SHARE", entry);
            Future<?> judging = pool.submit(
                    () -> moderation.judged(job, new EntryModerationVerdict(Decision.PASS, "none", null), "model", now));
            String waiting = db.awaitWaiting("from challenge_entries");
            probe.rollback();
            judging.get(20, TimeUnit.SECONDS);

            assertThat(waiting.toLowerCase()).contains("for update").doesNotContain("no key").doesNotContain("skip locked");
        } finally {
            pool.shutdownNow();
        }
        assertThat(status(entry)).isEqualTo("passed");
    }

    @Test
    @DisplayName("마감이 지난 챌린지의 판정은 마감 집계가 먼저다 — 챌린지 행에서 기다리는 동안 참여작 행은 잡지 않았다. 숨김 판정은 집계 뒤라 자격에 영향이 없다")
    void aVerdictAfterTheDeadlineSettlesFirst() throws Exception {
        UUID entry = pending(db.entry(challenge, author, created));
        Job job = moderation.claim(MAX, now);
        Instant afterDeadline = now.plus(Duration.ofDays(6));
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = db.probe()) {
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenges WHERE id=? FOR KEY SHARE", challenge);
            Future<?> judging = pool.submit(
                    () -> moderation.judged(job, new EntryModerationVerdict(Decision.HIDE, "spam", "광고"), "model", afterDeadline));
            db.awaitWaiting("from challenges");
            assertThat(db.locked("challenge_entries", entry)).isFalse();
            probe.rollback();
            judging.get(20, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        assertThat(db.jdbc.queryForMap("SELECT status,final_eligible,final_like_count FROM challenge_entries WHERE id=?", entry))
                .containsEntry("status", "hidden_by_report").containsEntry("final_eligible", true).containsEntry("final_like_count", 0L);
    }

    @Test
    @DisplayName("캡션 고치기가 참여작 행을 먼저 잡으면 판정은 그 커밋을 기다렸다가 바뀐 내용을 보고 아무것도 하지 않는다")
    void aVerdictBehindACaptionEditIsDropped() throws Exception {
        UUID entry = pending(db.entry(challenge, author, created));
        Job job = moderation.claim(MAX, now);
        CountDownLatch edited = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> editing = pool.submit(() -> db.inTransaction(() -> {
                entries.update(author, entry, "새 설명", null, null, now);
                edited.countDown();
                ChallengeStoreFixture.await(release);
            }));
            ChallengeStoreFixture.await(edited);
            Future<?> judging = pool.submit(
                    () -> moderation.judged(job, new EntryModerationVerdict(Decision.HIDE, "spam", "광고"), "model", now));
            db.awaitWaiting("from challenge_entries");
            release.countDown();
            editing.get(20, TimeUnit.SECONDS);
            judging.get(20, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        assertThat(db.jdbc.queryForMap("SELECT status,moderation_status,moderation_attempts,caption FROM challenge_entries WHERE id=?",
                entry)).containsEntry("status", "visible").containsEntry("moderation_status", "pending")
                .containsEntry("moderation_attempts", 0).containsEntry("caption", "새 설명");
        assertThat(db.count("entry_reports")).isZero();
    }

    // ---- 문장 ----

    @Test
    @DisplayName("나가는 문장: 집기는 상한에 닿은 것 잡기(건너뛰는 잠금) → 닫기 → 선점 한 문장. 판정은 부모 찾기 → 마감 확인 → 참여작 잠금 → 고치기(→ 숨김 → 신고)")
    void statements() {
        String sweep = "select challenge_entries for update skip locked";
        String claim = "with select challenge_entries for update skip locked returning";
        List<String> current = List.of("select challenge_entries", "select challenges", "select challenge_entries for update");

        assertThat(db.statementsOf(() -> moderation.claim(MAX, now))).as("집을 것이 없다").containsExactly(sweep, claim);
        UUID exhausted = pending(db.entry(challenge, author, created));
        db.jdbc.update("UPDATE challenge_entries SET moderation_attempts=3 WHERE id=?", exhausted);
        assertThat(db.statementsOf(() -> moderation.claim(MAX, now))).as("상한에 닿은 것 하나를 닫는다").containsExactly(
                sweep, "update challenge_entries", "select challenge_entries", "insert entry_reports", claim);

        UUID passed = pending(db.entry(challenge, author, created));
        Job job = moderation.claim(MAX, now);
        assertThat(db.statementsOf(() -> moderation.judged(job, new EntryModerationVerdict(Decision.PASS, "none", null), "m", now)))
                .containsExactly(current.get(0), current.get(1), current.get(2), "update challenge_entries");
        assertThat(db.statementsOf(() -> moderation.judged(job, new EntryModerationVerdict(Decision.PASS, "none", null), "m", now)))
                .as("차례가 끝난 참여작").containsExactly(current.get(0), current.get(1), current.get(2));

        pending(passed);
        Job review = moderation.claim(MAX, now);
        assertThat(db.statementsOf(() -> moderation.judged(review, new EntryModerationVerdict(Decision.REVIEW, "other", "?"), "m", now)))
                .containsExactly(current.get(0), current.get(1), current.get(2), "update challenge_entries", "insert entry_reports");
        pending(passed);
        Job hide = moderation.claim(MAX, now);
        assertThat(db.statementsOf(() -> moderation.judged(hide, new EntryModerationVerdict(Decision.HIDE, "spam", "?"), "m", now)))
                .containsExactly(current.get(0), current.get(1), current.get(2), "update challenge_entries",
                        "update challenge_entries", "insert entry_reports");
        pending(passed);
        Job failed = moderation.claim(MAX, now);
        assertThat(db.statementsOf(() -> moderation.fail(failed, now))).containsExactly(
                current.get(0), current.get(1), current.get(2), "update challenge_entries", "select challenge_entries",
                "insert entry_reports");
        assertThat(db.statementsOf(() -> moderation.fail(new Job(UUID.randomUUID(), 1, 1, null, "대사", null), now)))
                .as("없는 참여작").containsExactly("select challenge_entries");

        assertThat(db.statementsOf(() -> moderation.faceSeen(passed, true))).containsExactly("update challenge_entries");
        assertThat(db.statementsOf(() -> moderation.claimFaces(5, MAX))).containsExactly(claim);
    }

    /** 검사 차례로 둔다(시도 수 0). */
    private UUID pending(UUID entry) {
        db.jdbc.update("UPDATE challenge_entries SET moderation_status='pending',moderation_attempts=0 WHERE id=?", entry);
        return entry;
    }

    private String status(UUID entry) {
        return db.jdbc.queryForObject("SELECT moderation_status FROM challenge_entries WHERE id=?", String.class, entry);
    }

    private int attempts(UUID entry) {
        return db.jdbc.queryForObject("SELECT moderation_attempts FROM challenge_entries WHERE id=?", Integer.class, entry);
    }
}
