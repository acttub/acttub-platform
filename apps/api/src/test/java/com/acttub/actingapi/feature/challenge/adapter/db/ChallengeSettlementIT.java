package com.acttub.actingapi.feature.challenge.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 종료 랭킹의 마감 집계와 순위 확정({@link ChallengeSettlement})을 고정한다. 종료 뒤 목록·순위의 HTTP 응답과 운영 처리 뒤의
 * 확정은 {@code ChallengeEntryIT}·{@code ChallengeReactionIT} 가 본다. 여기서는 집계가 적는 값, 확정을 미루는 조건, 공동 순위,
 * 챌린지 행 잠금의 세기, 두 정산이 겹칠 때의 결과, 나가는 문장을 본다.
 */
@ChallengeStoreTest
class ChallengeSettlementIT {

    @Autowired
    ChallengeStoreFixture db;

    @Autowired
    ChallengeSettlement settlement;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");
    private final Instant opened = now.minus(Duration.ofDays(8));
    private final Instant deadline = now.minus(Duration.ofHours(1));
    private UUID challenge;

    @BeforeEach
    void setUp() {
        db.reset();
        challenge = db.challenge(opened, deadline);
    }

    // ---- 결과 ----

    @Test
    @DisplayName("settle: 마감 전이면 아무것도 하지 않는다. 마감과 같은 시각부터 집계한다. 없는 챌린지는 지나간다")
    void settleStartsAtTheDeadline() {
        UUID entry = db.entry(challenge, db.member("배우"), opened);

        settle(challenge, deadline.minusNanos(1_000));
        assertThat(state(challenge)).isNull();
        assertThat(db.jdbc.queryForObject("SELECT final_like_count FROM challenge_entries WHERE id=?", Long.class, entry)).isNull();

        settle(UUID.randomUUID(), now);
        settle(challenge, deadline);
        assertThat(state(challenge)).isEqualTo("final");
        assertThat(db.instant("SELECT finalized_at FROM challenges WHERE id=?", challenge)).isEqualTo(deadline);
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", entry)).isEqualTo(deadline);
    }

    @Test
    @DisplayName("집계: 지우지 않은 참여작마다 그때의 좋아요 수와 참가 자격을 적는다. 자격은 공개·보임(신고 숨김 포함)·모자이크 준비·작성자 활성·영상 있음이다")
    void aggregateStoresLikesAndEligibility() {
        UUID fan = db.member("팬");
        UUID plain = db.entry(challenge, db.member("기본"), opened);
        UUID liked = db.entry(challenge, db.member("좋아요 둘"), opened.plusSeconds(1));
        UUID hiddenByReport = db.entry(challenge, db.member("신고 숨김"), opened.plusSeconds(2));
        UUID privateEntry = db.entry(challenge, db.member("비공개"), opened.plusSeconds(3));
        UUID mosaicPending = db.entry(challenge, db.member("모자이크 만드는 중"), opened.plusSeconds(4));
        UUID mosaicReady = db.entry(challenge, db.member("모자이크 준비"), opened.plusSeconds(5));
        UUID closedAuthor = db.member("닫힌 계정");
        UUID ofClosed = db.entry(challenge, closedAuthor, opened.plusSeconds(6));
        UUID purged = db.entry(challenge, db.member("영상 파기"), opened.plusSeconds(7));
        UUID deleted = db.entry(challenge, db.member("지움"), opened.plusSeconds(8));
        like(liked, fan);
        like(liked, db.member("둘째 팬"));
        like(privateEntry, fan);
        db.jdbc.update("UPDATE challenge_entries SET status='hidden_by_report' WHERE id=?", hiddenByReport);
        db.jdbc.update("UPDATE challenge_entries SET visibility='private' WHERE id=?", privateEntry);
        db.jdbc.update("UPDATE challenge_entries SET face_mosaic=true,mosaic_status='pending' WHERE id=?", mosaicPending);
        db.jdbc.update("UPDATE challenge_entries SET face_mosaic=true,mosaic_status='ready',mosaic_key='m' WHERE id=?", mosaicReady);
        db.jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", closedAuthor);
        db.jdbc.update("UPDATE videos SET purged_at=now() WHERE id=(SELECT video_id FROM challenge_entries WHERE id=?)", purged);
        db.jdbc.update("UPDATE challenge_entries SET status='deleted',deleted_at=?,video_id=NULL WHERE id=?",
                ChallengeStoreFixture.utc(opened.plusSeconds(9)), deleted);

        settle(challenge, now);

        assertThat(aggregated(plain)).isEqualTo("0:true");
        assertThat(aggregated(liked)).isEqualTo("2:true");
        assertThat(aggregated(hiddenByReport)).as("신고 숨김은 자격을 통과로 적는다").isEqualTo("0:true");
        assertThat(aggregated(privateEntry)).isEqualTo("1:false");
        assertThat(aggregated(mosaicPending)).isEqualTo("0:false");
        assertThat(aggregated(mosaicReady)).isEqualTo("0:true");
        assertThat(aggregated(ofClosed)).isEqualTo("0:false");
        assertThat(aggregated(purged)).isEqualTo("0:false");
        assertThat(aggregated(deleted)).as("지운 참여작은 건드리지 않는다").isNull();
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", deleted)).isEqualTo(opened.plusSeconds(8));
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", privateEntry)).isEqualTo(now);
    }

    @Test
    @DisplayName("집계 때 지우지 않은 참여작을 가진 활성 회원마다 종료 알림 하나를 남긴다 — 참여작이 여럿이어도 하나, 닫힌 계정에는 없다")
    void aggregateNotifiesEachActiveParticipantOnce() {
        UUID twice = db.member("두 번 참여");
        UUID once = db.member("한 번 참여");
        UUID closed = db.member("닫힌 계정");
        UUID deletedOnly = db.member("지운 것뿐");
        db.entry(challenge, twice, opened);
        db.entry(challenge, twice, opened.plusSeconds(1));
        db.entry(challenge, once, opened.plusSeconds(2));
        db.entry(challenge, closed, opened.plusSeconds(3));
        UUID gone = db.entry(challenge, deletedOnly, opened.plusSeconds(4));
        db.jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", closed);
        db.jdbc.update("UPDATE challenge_entries SET status='deleted',deleted_at=now(),video_id=NULL WHERE id=?", gone);

        settle(challenge, now);
        settle(challenge, now.plusSeconds(60));

        assertThat(db.jdbc.queryForList("SELECT user_id FROM notifications WHERE kind='challenge_ended' AND event_key=?",
                UUID.class, "ended:" + challenge)).containsExactlyInAnyOrder(twice, once);
        assertThat(db.jdbc.queryForMap("SELECT actor_user_id,entry_id,challenge_id FROM notifications WHERE user_id=?", once))
                .containsEntry("actor_user_id", null).containsEntry("entry_id", null).containsEntry("challenge_id", challenge);
        assertThat(db.instant("SELECT created_at FROM notifications WHERE user_id=?", once)).isEqualTo(now);
    }

    @Test
    @DisplayName("순위: 자격이 있고 보이는 참여작에 좋아요 수 내림차순 공동 순위를 매긴다(3·3·1 → 1·1·3). 자격이 없거나 숨긴 참여작은 순위가 없다")
    void confirmRanksEligibleVisibleEntriesWithTies() {
        UUID first = db.entry(challenge, db.member("가"), opened);
        UUID tied = db.entry(challenge, db.member("나"), opened.plusSeconds(1));
        UUID third = db.entry(challenge, db.member("다"), opened.plusSeconds(2));
        UUID privateEntry = db.entry(challenge, db.member("라"), opened.plusSeconds(3));
        UUID keptHidden = db.entry(challenge, db.member("마"), opened.plusSeconds(4));
        likes(first, 3);
        likes(tied, 3);
        likes(third, 1);
        likes(privateEntry, 5);
        likes(keptHidden, 4);
        db.jdbc.update("UPDATE challenge_entries SET visibility='private' WHERE id=?", privateEntry);
        db.jdbc.update("UPDATE challenge_entries SET status='hidden_by_report' WHERE id=?", keptHidden);

        settle(challenge, now);

        assertThat(state(challenge)).as("처리되지 않은 신고가 없는 숨김은 확정을 미루지 않는다").isEqualTo("final");
        assertThat(rank(first)).isEqualTo(1);
        assertThat(rank(tied)).isEqualTo(1);
        assertThat(rank(third)).isEqualTo(3);
        assertThat(rank(privateEntry)).isNull();
        assertThat(rank(keptHidden)).isNull();
        assertThat(aggregated(keptHidden)).isEqualTo("4:true");
    }

    @Test
    @DisplayName("확정을 미루는 조건: 챌린지가 review 이거나, 자격이 있던 참여작이 신고로 숨겨져 처리되지 않은 신고가 남아 있다. 풀리면 다음 정산이 확정한다")
    void confirmWaitsForReviews() {
        UUID entry = db.entry(challenge, db.member("신고된 배우"), opened);
        UUID other = db.entry(challenge, db.member("다른 배우"), opened.plusSeconds(1));
        likes(entry, 2);
        db.jdbc.update("UPDATE challenge_entries SET status='hidden_by_report' WHERE id=?", entry);
        UUID report = report("entry", entry);

        settle(challenge, now);
        assertThat(state(challenge)).isEqualTo("pending");
        assertThat(rank(other)).as("미루는 동안 순위는 없다").isNull();
        assertThat(aggregated(entry)).isEqualTo("2:true");

        db.jdbc.update("UPDATE challenge_entries SET status='visible' WHERE id=?", entry);
        db.jdbc.update("UPDATE challenges SET moderation='review' WHERE id=?", challenge);
        settle(challenge, now.plusSeconds(60));
        assertThat(state(challenge)).as("review 인 챌린지").isEqualTo("pending");

        db.jdbc.update("UPDATE challenges SET moderation='visible' WHERE id=?", challenge);
        db.jdbc.update("UPDATE entry_reports SET status='reviewed',resolution='dismissed',reviewed_at=now() WHERE id=?", report);
        Instant later = now.plusSeconds(120);
        settle(challenge, later);

        assertThat(state(challenge)).isEqualTo("final");
        assertThat(db.instant("SELECT finalized_at FROM challenges WHERE id=?", challenge)).isEqualTo(later);
        assertThat(rank(entry)).as("집계 때 좋아요 수로 순위에 든다").isEqualTo(1);
        assertThat(rank(other)).isEqualTo(2);
        assertThat(aggregated(entry)).as("다시 집계하지 않는다").isEqualTo("2:true");
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", other)).isEqualTo(later);
    }

    @Test
    @DisplayName("확정된 챌린지를 다시 정산해도 그대로다 — 순위와 확정 시각을 다시 쓰지 않는다")
    void settlingAFinalChallengeChangesNothing() {
        UUID entry = db.entry(challenge, db.member("배우"), opened);
        settle(challenge, now);
        like(entry, db.member("늦은 팬"));

        settle(challenge, now.plusSeconds(3600));

        assertThat(db.instant("SELECT finalized_at FROM challenges WHERE id=?", challenge)).isEqualTo(now);
        assertThat(aggregated(entry)).isEqualTo("0:true");
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", entry)).isEqualTo(now);
    }

    @Test
    @DisplayName("aggregateIfDue: 마감이 지났고 집계 전일 때만 정산한다. 집계 중인 챌린지는 건드리지 않는다(확정 시도는 변경·운영·매시 일이 한다)")
    void aggregateIfDueOnlyActsOnDueChallenges() {
        UUID entry = db.entry(challenge, db.member("배우"), opened);
        UUID live = db.challenge(opened, now.plusSeconds(1));

        db.inTransaction(() -> settlement.aggregateIfDue(live, now));
        db.inTransaction(() -> settlement.aggregateIfDue(UUID.randomUUID(), now));
        assertThat(state(live)).isNull();

        db.jdbc.update("UPDATE challenges SET moderation='review' WHERE id=?", challenge);
        db.inTransaction(() -> settlement.aggregateIfDue(challenge, now));
        assertThat(state(challenge)).isEqualTo("pending");
        db.jdbc.update("UPDATE challenges SET moderation='visible' WHERE id=?", challenge);
        db.inTransaction(() -> settlement.aggregateIfDue(challenge, now.plusSeconds(60)));
        assertThat(state(challenge)).as("집계 중이면 그대로 둔다").isEqualTo("pending");
        assertThat(rank(entry)).isNull();
    }

    @Test
    @DisplayName("waiting: 집계가 밀렸거나(마감과 같은 시각 포함) 확정을 기다리는 챌린지를 마감 순으로 200개까지 낸다")
    void waitingListsDueAndPendingChallengesByDeadline() {
        UUID pendingOlder = db.challenge(opened, deadline.minusSeconds(60));
        db.jdbc.update("UPDATE challenges SET ranking_state='pending' WHERE id=?", pendingOlder);
        UUID atNow = db.challenge(opened, now);
        UUID live = db.challenge(opened, now.plusNanos(1_000));
        UUID done = db.challenge(opened, deadline.minusSeconds(120));
        db.jdbc.update("UPDATE challenges SET ranking_state='final',finalized_at=now() WHERE id=?", done);

        assertThat(db.inTransaction(() -> settlement.waiting(now))).containsExactly(pendingOlder, challenge, atNow)
                .doesNotContain(live, done);

        db.jdbc.update("""
                INSERT INTO challenges(id,line,work,duration_days,origin,request_id,request_fingerprint,starts_at,ends_at)
                SELECT gen_random_uuid(),'대사 '||n,'창작',7,'team',gen_random_uuid(),repeat('0',64),?,? + make_interval(secs => n)
                FROM generate_series(1,205) n
                """, ChallengeStoreFixture.utc(opened), ChallengeStoreFixture.utc(deadline.minus(Duration.ofDays(1))));
        List<UUID> capped = db.inTransaction(() -> settlement.waiting(now));
        assertThat(capped).hasSize(200).doesNotContain(pendingOlder, challenge, atNow);
        assertThat(capped.getFirst()).isEqualTo(db.jdbc.queryForObject(
                "SELECT id FROM challenges ORDER BY ends_at LIMIT 1", UUID.class));
    }

    // ---- 잠금과 경합 ----

    @Test
    @DisplayName("settle 은 챌린지 행을 FOR UPDATE 로 잡는다 — 바깥 연결의 FOR KEY SHARE 뒤에서 기다리고, 그동안 아무것도 적지 않는다")
    void settleLocksTheChallengeForUpdate() throws Exception {
        UUID entry = db.entry(challenge, db.member("배우"), opened);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = db.probe()) {
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenges WHERE id=? FOR KEY SHARE", challenge);
            Future<?> settling = pool.submit(() -> settle(challenge, now));
            String waiting = db.awaitWaiting("from challenges");
            assertThat(aggregated(entry)).isNull();
            probe.rollback();
            settling.get(20, TimeUnit.SECONDS);

            assertThat(waiting.toLowerCase()).contains("for update").doesNotContain("no key");
        } finally {
            pool.shutdownNow();
        }
        assertThat(state(challenge)).isEqualTo("final");
    }

    @Test
    @DisplayName("aggregateIfDue 의 마감 확인은 잠그지 않는다 — 챌린지 행을 다른 연결이 FOR UPDATE 로 쥐고 있어도 마감 전이면 바로 지나간다")
    void theDueCheckDoesNotLock() throws Exception {
        UUID live = db.challenge(opened, now.plusSeconds(1));
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = db.probe()) {
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenges WHERE id=? FOR UPDATE", live);
            pool.submit(() -> db.inTransaction(() -> settlement.aggregateIfDue(live, now))).get(20, TimeUnit.SECONDS);
            probe.rollback();
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("같은 챌린지를 두 정산이 함께 잡으면 뒤의 것이 앞의 커밋을 기다렸다가 확정된 것을 보고 아무것도 하지 않는다 — 집계와 종료 알림은 한 번이다")
    void twoSettlementsOfTheSameChallenge() throws Exception {
        UUID participant = db.member("배우");
        UUID entry = db.entry(challenge, participant, opened);
        CountDownLatch settled = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> first = pool.submit(() -> db.inTransaction(() -> {
                settlement.settle(challenge, now);
                settled.countDown();
                ChallengeStoreFixture.await(release);
            }));
            ChallengeStoreFixture.await(settled);
            Future<List<String>> second = pool.submit(() -> db.statementsOf(() -> settle(challenge, now.plusSeconds(3600))));
            db.awaitWaiting("from challenges");
            release.countDown();

            first.get(20, TimeUnit.SECONDS);
            assertThat(second.get(20, TimeUnit.SECONDS)).containsExactly("select challenges for update");
        } finally {
            pool.shutdownNow();
        }
        assertThat(db.instant("SELECT finalized_at FROM challenges WHERE id=?", challenge)).isEqualTo(now);
        assertThat(db.instant("SELECT updated_at FROM challenge_entries WHERE id=?", entry)).isEqualTo(now);
        assertThat(db.jdbc.queryForObject("SELECT count(*) FROM notifications WHERE user_id=?", Integer.class, participant))
                .isEqualTo(1);
    }

    // ---- 문장 ----

    @Test
    @DisplayName("나가는 문장: 잠금 → 집계(참여작·챌린지·참여자·알림 사건) → 확정(미루는 조건·순위·챌린지). 미루면 조건 확인에서 멈춘다")
    void statements() {
        db.entry(challenge, db.member("배우"), opened);
        UUID blocked = db.challenge(opened, deadline);
        db.jdbc.update("UPDATE challenges SET moderation='review' WHERE id=?", blocked);
        UUID live = db.challenge(opened, now.plusSeconds(1));
        List<String> event = List.of("select notifications", "select user_profiles", "insert notifications on conflict");

        assertThat(db.statementsOf(() -> settle(live, now))).as("마감 전").containsExactly("select challenges for update");
        assertThat(db.statementsOf(() -> settle(UUID.randomUUID(), now))).containsExactly("select challenges for update");
        assertThat(db.statementsOf(() -> settle(blocked, now))).as("참여작 없이 확정을 미룬다").containsExactly(
                "select challenges for update", "update challenge_entries", "update challenges", "select challenge_entries",
                "select challenges");
        assertThat(db.statementsOf(() -> settle(blocked, now))).as("집계 중").containsExactly(
                "select challenges for update", "select challenges");
        assertThat(db.statementsOf(() -> settle(challenge, now))).as("집계하고 확정한다").containsExactly(
                "select challenges for update", "update challenge_entries", "update challenges", "select challenge_entries",
                event.get(0), event.get(1), event.get(2),
                "select challenges", "update challenge_entries", "update challenges");
        assertThat(db.statementsOf(() -> settle(challenge, now))).as("확정됨").containsExactly("select challenges for update");

        assertThat(db.statementsOf(() -> db.inTransaction(() -> settlement.aggregateIfDue(live, now))))
                .containsExactly("select challenges");
        assertThat(db.statementsOf(() -> db.inTransaction(() -> settlement.waiting(now)))).containsExactly("select challenges");
    }

    private void settle(UUID id, Instant at) {
        db.inTransaction(() -> settlement.settle(id, at));
    }

    private String state(UUID id) {
        return db.jdbc.queryForObject("SELECT ranking_state FROM challenges WHERE id=?", String.class, id);
    }

    /** "<마감 좋아요 수>:<참가 자격>". 집계 전이면 null. */
    private String aggregated(UUID entry) {
        return db.jdbc.queryForObject(
                "SELECT final_like_count || ':' || final_eligible FROM challenge_entries WHERE id=?", String.class, entry);
    }

    private Integer rank(UUID entry) {
        return db.jdbc.queryForObject("SELECT final_rank FROM challenge_entries WHERE id=?", Integer.class, entry);
    }

    private void like(UUID entry, UUID by) {
        db.jdbc.update("INSERT INTO entry_likes(id,entry_id,user_id) VALUES (?,?,?)", UUID.randomUUID(), entry, by);
    }

    private void likes(UUID entry, int count) {
        for (int i = 0; i < count; i++) {
            like(entry, db.member("팬"));
        }
    }

    private UUID report(String type, UUID target) {
        UUID id = UUID.randomUUID();
        db.jdbc.update("""
                INSERT INTO entry_reports(id,target_type,target_id,reporter_id,reason,status,target_version,request_id,request_fingerprint)
                VALUES (?,?,?,?,'spam','received',1,?,?)
                """, id, type, target, db.member("신고자"), UUID.randomUUID(), "0".repeat(64));
        return id;
    }
}
