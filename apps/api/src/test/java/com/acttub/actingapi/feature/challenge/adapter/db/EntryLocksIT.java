package com.acttub.actingapi.feature.challenge.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 반응·신고가 쓰는 잠금({@link EntryLocks})의 결과·세기·순서를 고정한다. 누구에게 무엇이 보이는지의 HTTP 응답은
 * {@code ChallengeReactionIT}·{@code ChallengeEntryIT} 가 본다. 여기서는 잠그는 문장의 세기(쓰기는 {@code FOR UPDATE}, 읽기는
 * {@code FOR SHARE}), 사람(id 순) → 챌린지(마감 집계) → 참여작 순서, 개인 노출 조건의 경계, 나가는 문장을 본다.
 */
@ChallengeStoreTest
class EntryLocksIT {

    @Autowired
    ChallengeStoreFixture db;

    @Autowired
    EntryLocks locks;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");
    private UUID author;
    private UUID viewer;
    private UUID challenge;
    private UUID entry;

    @BeforeEach
    void setUp() {
        db.reset();
        author = db.member("작성자");
        viewer = db.member("보는 사람");
        challenge = db.challenge(now.minus(Duration.ofDays(1)), now.plus(Duration.ofDays(6)));
        entry = db.entry(challenge, author, now.minus(Duration.ofHours(1)));
        db.jdbc.update("UPDATE challenge_entries SET caption='설명',content_version=3 WHERE id=?", entry);
    }

    // ---- 결과 ----

    @Test
    @DisplayName("entry: 작성자·챌린지·내용 버전·설명을 낸다. 없는 것·지운 것·보이지 않는 것은 404 entry_not_found 다")
    void entryReturnsTheTargetOrNotFound() {
        assertThat(lockEntry(viewer, entry, false, false)).isEqualTo(new EntryLocks.Target(author, challenge, 3, "설명"));
        assertThat(lockEntry(viewer, entry, true, false)).isEqualTo(new EntryLocks.Target(author, challenge, 3, "설명"));

        assertNotFound(() -> lockEntry(viewer, UUID.randomUUID(), false, false));
        db.jdbc.update("UPDATE challenge_entries SET visibility='private' WHERE id=?", entry);
        assertNotFound(() -> lockEntry(viewer, entry, false, false));
        assertNotFound(() -> lockEntry(viewer, entry, false, true));
        assertNotFound(() -> lockEntry(author, entry, false, false));
        assertThat(lockEntry(author, entry, false, true)).as("본인 것은 공개 조건 없이 통과")
                .isEqualTo(new EntryLocks.Target(author, challenge, 3, "설명"));
        db.jdbc.update("UPDATE challenge_entries SET status='deleted',deleted_at=?,video_id=NULL,caption=NULL WHERE id=?",
                ChallengeStoreFixture.utc(now), entry);
        assertNotFound(() -> lockEntry(author, entry, false, true));
    }

    @Test
    @DisplayName("행동하는 사람이 활성이 아니거나 없으면 403 account_deactivated 다. 작성자가 활성이 아니면 보이지 않아 404 다")
    void inactivePeople() {
        UUID closed = db.member("닫힌 계정");
        db.jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", closed);

        for (UUID actor : List.of(closed, UUID.randomUUID())) {
            assertThatThrownBy(() -> lockEntry(actor, entry, false, false))
                    .isInstanceOfSatisfying(ApiException.class, refused -> {
                        assertThat(refused.status()).isEqualTo(403);
                        assertThat(refused.getMessage()).isEqualTo("account_deactivated");
                    });
            assertThatThrownBy(() -> db.inTransaction(() -> locks.active(actor)))
                    .isInstanceOfSatisfying(ApiException.class, refused -> assertThat(refused.status()).isEqualTo(403));
            assertThatThrownBy(() -> db.inTransaction(() -> locks.people(actor, viewer, false)))
                    .isInstanceOfSatisfying(ApiException.class, refused -> assertThat(refused.status()).isEqualTo(403));
        }
        assertThat(db.inTransaction(() -> locks.people(viewer, closed, false))).as("상대는 있기만 하면 된다").isTrue();
        assertThat(db.inTransaction(() -> locks.people(viewer, UUID.randomUUID(), false))).as("상대가 없다").isFalse();
        assertThat(db.inTransaction(() -> locks.people(viewer, viewer, false))).isTrue();

        db.jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", author);
        assertNotFound(() -> lockEntry(viewer, entry, false, false));
    }

    @Test
    @DisplayName("visible: 공개 조건(공개·보임·작성자 활성·영상 있음·챌린지 보임·모자이크 준비)과 양방향 차단 없음. 본인 것은 ownAllowed 일 때만 조건 없이 보인다")
    void visibleFollowsThePublicConditionAndBlocks() {
        assertThat(visible(viewer, false)).isTrue();
        assertThat(visible(author, false)).isTrue();

        String[] hidden = {
            "UPDATE challenge_entries SET visibility='private' WHERE id=?",
            "UPDATE challenge_entries SET status='hidden_by_report' WHERE id=?",
            "UPDATE challenge_entries SET face_mosaic=true,mosaic_status='pending' WHERE id=?",
            "UPDATE challenge_entries SET face_mosaic=true,mosaic_status='failed' WHERE id=?",
            "UPDATE videos SET purged_at=now() WHERE id=(SELECT video_id FROM challenge_entries WHERE id=?)",
            "UPDATE users SET status='deactivated' WHERE id=(SELECT user_id FROM challenge_entries WHERE id=?)",
            "UPDATE challenges SET moderation='review' WHERE id=(SELECT challenge_id FROM challenge_entries WHERE id=?)",
            "UPDATE challenges SET moderation='hidden' WHERE id=(SELECT challenge_id FROM challenge_entries WHERE id=?)",
            "UPDATE challenges SET deleted_at=now() WHERE id=(SELECT challenge_id FROM challenge_entries WHERE id=?)",
        };
        for (String change : hidden) {
            setUp();
            db.jdbc.update(change, entry);
            assertThat(visible(viewer, false)).as(change).isFalse();
            assertThat(visible(viewer, true)).as(change).isFalse();
            assertThat(visible(author, false)).as(change).isFalse();
            assertThat(visible(author, true)).as("본인 것: " + change).isTrue();
        }

        setUp();
        db.jdbc.update("UPDATE challenge_entries SET face_mosaic=true,mosaic_status='ready',mosaic_key='m' WHERE id=?", entry);
        assertThat(visible(viewer, false)).as("모자이크본이 준비됐다").isTrue();

        for (boolean viewerBlocks : new boolean[] {true, false}) {
            setUp();
            db.jdbc.update("INSERT INTO user_blocks(id,blocker_id,blocked_id) VALUES (?,?,?)", UUID.randomUUID(),
                    viewerBlocks ? viewer : author, viewerBlocks ? author : viewer);
            assertThat(visible(viewer, false)).as("차단(보는 사람이 건 것: %s)", viewerBlocks).isFalse();
            assertThat(visible(viewer, true)).isFalse();
            assertThat(visible(db.member("다른 사람"), false)).as("다른 사람에게는 보인다").isTrue();
        }

        setUp();
        db.jdbc.update("UPDATE challenge_entries SET status='deleted',deleted_at=now(),video_id=NULL,caption=NULL WHERE id=?", entry);
        assertThat(visible(author, true)).as("지운 것은 본인에게도 없다").isFalse();
    }

    // ---- 잠금 ----

    @Test
    @DisplayName("entry 의 쓰기 잠금은 참여작 행을 FOR UPDATE 로 잡는다 — 바깥 연결의 FOR KEY SHARE 뒤에서 기다린다")
    void exclusiveEntryLockIsForUpdate() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = db.probe()) {
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenge_entries WHERE id=? FOR KEY SHARE", entry);
            Future<EntryLocks.Target> locking = pool.submit(() -> lockEntry(viewer, entry, true, false));
            String waiting = db.awaitWaiting("from challenge_entries");
            probe.rollback();

            assertThat(waiting.toLowerCase()).contains("for update").doesNotContain("no key");
            assertThat(locking.get(20, TimeUnit.SECONDS).author()).isEqualTo(author);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("entry 의 읽기 잠금은 참여작 행을 FOR SHARE 로 잡는다 — 다른 FOR SHARE 와 함께 가고, FOR NO KEY UPDATE 뒤에서는 기다린다")
    void sharedEntryLockIsForShare() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = db.probe()) {
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenge_entries WHERE id=? FOR SHARE", entry);
            assertThat(pool.submit(() -> lockEntry(viewer, entry, false, false)).get(20, TimeUnit.SECONDS).author())
                    .isEqualTo(author);
            probe.rollback();

            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenge_entries WHERE id=? FOR NO KEY UPDATE", entry);
            Future<EntryLocks.Target> locking = pool.submit(() -> lockEntry(viewer, entry, false, false));
            String waiting = db.awaitWaiting("from challenge_entries");
            probe.rollback();

            assertThat(waiting.toLowerCase()).contains("for share");
            assertThat(locking.get(20, TimeUnit.SECONDS).author()).isEqualTo(author);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("읽기 잠금을 쥔 동안 다른 트랜잭션은 그 참여작 행을 고치지 못한다. 읽기 잠금끼리는 함께 쥔다")
    void aSharedEntryLockKeepsWritersOut() throws Exception {
        try (Connection probe = db.probe()) {
            db.inTransaction(() -> {
                locks.entry(viewer, entry, now, false, false);
                try {
                    assertThat(db.locked("challenge_entries", entry)).isTrue();
                    ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenge_entries WHERE id=? FOR SHARE NOWAIT", entry);
                    probe.rollback();
                } catch (Exception exc) {
                    throw new IllegalStateException(exc);
                }
            });
        }
        assertThat(db.locked("challenge_entries", entry)).isFalse();
    }

    @Test
    @DisplayName("사람 행은 id 순서로 잠근다 — 행동하는 사람은 FOR UPDATE, 상대는 FOR SHARE(otherExclusive 면 FOR UPDATE). 같은 사람이면 한 번이다")
    void peopleAreLockedInIdOrder() {
        UUID smaller = author.compareTo(viewer) < 0 ? author : viewer;
        UUID larger = smaller.equals(author) ? viewer : author;

        assertThat(db.statementsOf(() -> db.inTransaction(() -> locks.people(smaller, larger, false))))
                .containsExactly("select users for update", "select users for share");
        assertThat(db.statementsOf(() -> db.inTransaction(() -> locks.people(larger, smaller, false))))
                .containsExactly("select users for share", "select users for update");
        assertThat(db.statementsOf(() -> db.inTransaction(() -> locks.people(larger, smaller, true))))
                .containsExactly("select users for update", "select users for update");
        assertThat(db.statementsOf(() -> db.inTransaction(() -> locks.people(larger, larger, false))))
                .containsExactly("select users for update");
        assertThat(db.statementsOf(() -> db.inTransaction(() -> locks.active(larger))))
                .containsExactly("select users for update");
    }

    @Test
    @DisplayName("entry 는 사람 → 챌린지 → 참여작 순서로 잡는다 — 참여작 행에서 기다리는 동안 두 사람 행은 이미 잡고 있고, 사람 행에서 기다리는 동안 참여작 행은 잡지 않았다")
    void entryLocksPeopleBeforeTheEntry() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = db.probe()) {
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenge_entries WHERE id=? FOR UPDATE", entry);
            Future<EntryLocks.Target> onEntry = pool.submit(() -> lockEntry(viewer, entry, true, false));
            db.awaitWaiting("from challenge_entries");
            assertThat(db.locked("users", viewer)).isTrue();
            assertThat(db.locked("users", author)).as("상대는 FOR SHARE 로 잡혀 있다").isTrue();
            probe.rollback();
            onEntry.get(20, TimeUnit.SECONDS);

            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM users WHERE id=? FOR UPDATE", author);
            Future<EntryLocks.Target> onPerson = pool.submit(() -> lockEntry(viewer, entry, true, false));
            db.awaitWaiting("from users");
            assertThat(db.locked("challenge_entries", entry)).isFalse();
            probe.rollback();
            onPerson.get(20, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("마감이 지났고 집계 전이면 참여작을 잠그기 전에 챌린지 행을 잡고 마감 집계를 한다 — 챌린지 행에서 기다리는 동안 참여작 행은 잡지 않았다")
    void aDueChallengeIsSettledBeforeTheEntryIsLocked() throws Exception {
        Instant afterDeadline = now.plus(Duration.ofDays(6));
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = db.probe()) {
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenges WHERE id=? FOR KEY SHARE", challenge);
            Future<?> locking = pool.submit(() -> db.inTransaction(() -> locks.entry(viewer, entry, afterDeadline, false, false)));
            String waiting = db.awaitWaiting("from challenges");
            assertThat(db.locked("challenge_entries", entry)).isFalse();
            assertThat(db.locked("users", viewer)).isTrue();
            probe.rollback();
            locking.get(20, TimeUnit.SECONDS);

            assertThat(waiting.toLowerCase()).contains("for update").doesNotContain("no key");
        } finally {
            pool.shutdownNow();
        }
        assertThat(db.jdbc.queryForObject("SELECT ranking_state FROM challenges WHERE id=?", String.class, challenge))
                .isEqualTo("final");
        assertThat(db.jdbc.queryForObject("SELECT final_like_count FROM challenge_entries WHERE id=?", Long.class, entry))
                .isZero();
    }

    // ---- 문장 ----

    @Test
    @DisplayName("나가는 문장: entry 는 찾기 → 사람 둘 → 마감 확인 → 참여작 잠금 → 노출 확인. 본인 것을 허용하면 공개 조건에서 떨어질 때만 본인 확인이 하나 는다")
    void statements() {
        List<String> people = author.compareTo(viewer) < 0
                ? List.of("select users for share", "select users for update")
                : List.of("select users for update", "select users for share");

        assertThat(db.statementsOf(() -> lockEntry(viewer, entry, false, false))).containsExactly(
                "select challenge_entries", people.get(0), people.get(1), "select challenges",
                "select challenge_entries for share", "select challenge_entries");
        assertThat(db.statementsOf(() -> lockEntry(viewer, entry, true, false))).containsExactly(
                "select challenge_entries", people.get(0), people.get(1), "select challenges",
                "select challenge_entries for update", "select challenge_entries");
        assertThat(db.statementsOf(() -> lockEntry(author, entry, false, true))).as("공개된 본인 것").containsExactly(
                "select challenge_entries", "select users for update", "select challenges",
                "select challenge_entries for share", "select challenge_entries");
        assertThat(db.statementsOf(() -> assertNotFound(() -> lockEntry(viewer, UUID.randomUUID(), false, false))))
                .as("없는 참여작").containsExactly("select challenge_entries");

        db.jdbc.update("UPDATE challenge_entries SET visibility='private' WHERE id=?", entry);
        assertThat(db.statementsOf(() -> lockEntry(author, entry, false, true))).as("비공개인 본인 것").containsExactly(
                "select challenge_entries", "select users for update", "select challenges",
                "select challenge_entries for share", "select challenge_entries", "select challenge_entries");
        assertThat(db.statementsOf(() -> db.inTransaction(() -> locks.visible(viewer, entry, false))))
                .containsExactly("select challenge_entries");
        assertThat(db.statementsOf(() -> db.inTransaction(() -> locks.visible(viewer, entry, true))))
                .containsExactly("select challenge_entries", "select challenge_entries");
    }

    private EntryLocks.Target lockEntry(UUID who, UUID entryId, boolean exclusive, boolean ownAllowed) {
        return db.inTransaction(() -> locks.entry(who, entryId, now, exclusive, ownAllowed));
    }

    private boolean visible(UUID who, boolean ownAllowed) {
        return db.inTransaction(() -> locks.visible(who, entry, ownAllowed));
    }

    private static void assertNotFound(Runnable call) {
        assertThatThrownBy(call::run).isInstanceOfSatisfying(ApiException.class, missing -> {
            assertThat(missing.status()).isEqualTo(404);
            assertThat(missing.getMessage()).isEqualTo("entry_not_found");
        });
    }
}
