package com.acttub.actingapi.feature.challenge.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.challenge.app.ChallengeWithdrawal;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 탈퇴 전 정산({@code settleBeforeWithdrawal})이 고르는 챌린지와 잠그는 순서를 고정한다. 탈퇴 뒤에도 그 참여작이 종료 순위에
 * 남는 것은 {@code ChallengeNotificationIT#accountWithdraw_afterTheDeadlineStillCountsTheEntryInTheFinalRanking} 가 본다.
 * 여기서는 고르는 조건의 경계, 챌린지 id 순서로 잠그는 것, 나가는 문장을 본다.
 */
@ChallengeStoreTest
class ChallengeWithdrawalStoreIT {

    @Autowired
    ChallengeStoreFixture db;

    @Autowired
    ChallengeWithdrawal withdrawal;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");
    private final Instant opened = now.minus(Duration.ofDays(8));
    private final Instant ended = now.minus(Duration.ofDays(1));

    @BeforeEach
    void setUp() {
        db.reset();
    }

    @Test
    @DisplayName("마감이 지났고(같은 시각 포함) 아직 집계 전인 챌린지 가운데 그 회원의 지우지 않은 참여작이 있는 것만 정산한다")
    void settlesOnlyDueChallengesTheMemberStillHasAnEntryIn() {
        UUID leaving = db.member("떠나는 배우");
        UUID other = db.member("남는 배우");
        UUID due = db.challenge(opened, ended);
        UUID atDeadline = db.challenge(opened, now);
        UUID deletedOnly = db.challenge(opened, ended);
        UUID live = db.challenge(opened, now.plusSeconds(1));
        UUID alreadyFinal = db.challenge(opened, ended);
        UUID othersOnly = db.challenge(opened, ended);
        UUID first = db.entry(due, leaving, ended.minusSeconds(60));
        UUID second = db.entry(due, leaving, ended.minusSeconds(30));
        UUID rival = db.entry(due, other, ended.minusSeconds(10));
        db.entry(atDeadline, leaving, opened);
        UUID deleted = db.entry(deletedOnly, leaving, opened);
        db.jdbc.update("UPDATE challenge_entries SET status='deleted',deleted_at=?,video_id=NULL WHERE id=?",
                ChallengeStoreFixture.utc(ended), deleted);
        db.entry(live, leaving, opened);
        db.entry(alreadyFinal, leaving, opened);
        Instant finalizedBefore = ended.plusSeconds(5);
        db.jdbc.update("UPDATE challenges SET ranking_state='final',finalized_at=? WHERE id=?",
                ChallengeStoreFixture.utc(finalizedBefore), alreadyFinal);
        db.entry(othersOnly, other, opened);
        like(rival, leaving);

        db.inTransaction(() -> withdrawal.settleBeforeWithdrawal(leaving, now));

        assertThat(state(due)).isEqualTo("final");
        assertThat(state(atDeadline)).as("마감과 같은 시각").isEqualTo("final");
        assertThat(db.instant("SELECT finalized_at FROM challenges WHERE id=?", due)).isEqualTo(now);
        assertThat(state(deletedOnly)).as("지운 참여작뿐").isNull();
        assertThat(state(live)).as("아직 진행 중").isNull();
        assertThat(state(othersOnly)).as("남의 참여작뿐").isNull();
        assertThat(db.instant("SELECT finalized_at FROM challenges WHERE id=?", alreadyFinal))
                .as("이미 확정된 것은 다시 건드리지 않는다").isEqualTo(finalizedBefore);
        assertThat(db.jdbc.queryForList("""
                SELECT final_like_count || ':' || final_eligible || ':' || final_rank FROM challenge_entries
                WHERE challenge_id=? ORDER BY created_at
                """, String.class, due)).containsExactly("0:true:2", "0:true:2", "1:true:1");
        assertThat(db.jdbc.queryForObject("SELECT final_rank FROM challenge_entries WHERE id=?", Integer.class, first))
                .isEqualTo(db.jdbc.queryForObject("SELECT final_rank FROM challenge_entries WHERE id=?", Integer.class, second));
        assertThat(db.jdbc.queryForList("""
                SELECT event_key FROM notifications WHERE user_id=? AND kind='challenge_ended' ORDER BY event_key
                """, String.class, leaving)).containsExactlyInAnyOrder("ended:" + due, "ended:" + atDeadline);
    }

    @Test
    @DisplayName("정산할 챌린지를 id 순서로 하나씩 잠근다 — 앞의 것에서 기다리는 동안 뒤의 것은 잠겨 있지 않고, 뒤의 것에서 기다릴 때는 앞의 것을 이미 잡고 있다")
    void locksDueChallengesInIdOrder() throws Exception {
        UUID leaving = db.member("떠나는 배우");
        UUID smaller = db.challenge(id(1), opened, ended);
        UUID larger = db.challenge(id(2), opened, ended);
        db.entry(larger, leaving, opened);
        db.entry(smaller, leaving, opened);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = db.probe()) {
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenges WHERE id=? FOR UPDATE", smaller);
            Future<?> blockedOnSmaller = pool.submit(() -> db.inTransaction(() -> withdrawal.settleBeforeWithdrawal(leaving, now)));
            String waiting = db.awaitWaiting("from challenges");
            assertThat(db.locked("challenges", larger)).as("앞의 것에서 기다리는 동안 뒤의 것은 아직 잡지 않았다").isFalse();
            probe.rollback();
            blockedOnSmaller.get(20, TimeUnit.SECONDS);
            assertThat(waiting.toLowerCase()).contains("for update").doesNotContain("no key");
            assertThat(state(smaller)).isEqualTo("final");
            assertThat(state(larger)).isEqualTo("final");

            db.jdbc.update("UPDATE challenges SET ranking_state=NULL,finalized_at=NULL");
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenges WHERE id=? FOR UPDATE", larger);
            Future<?> blockedOnLarger = pool.submit(() -> db.inTransaction(() -> withdrawal.settleBeforeWithdrawal(leaving, now)));
            db.awaitWaiting("from challenges");
            assertThat(db.locked("challenges", smaller)).as("뒤의 것에서 기다릴 때 앞의 것은 이미 잡고 있다").isTrue();
            probe.rollback();
            blockedOnLarger.get(20, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        assertThat(state(smaller)).isEqualTo("final");
        assertThat(state(larger)).isEqualTo("final");
    }

    @Test
    @DisplayName("나가는 문장: 고르는 조회 하나, 이어서 챌린지마다 정산. 정산할 것이 없으면 조회 하나뿐이다")
    void statements() {
        UUID leaving = db.member("떠나는 배우");
        UUID due = db.challenge(opened, ended);
        db.entry(due, leaving, opened);
        db.entry(due, leaving, opened.plusSeconds(1));

        assertThat(db.statementsOf(() -> db.inTransaction(() -> withdrawal.settleBeforeWithdrawal(leaving, now))))
                .containsExactly("select challenges",
                        "select challenges for update",
                        "update challenge_entries", "update challenges", "select challenge_entries",
                        "select notifications", "select user_profiles", "insert notifications on conflict",
                        "select challenges", "update challenge_entries", "update challenges");
        assertThat(db.statementsOf(() -> db.inTransaction(() -> withdrawal.settleBeforeWithdrawal(leaving, now))))
                .as("이미 확정됐다")
                .containsExactly("select challenges");
    }

    private String state(UUID challenge) {
        return db.jdbc.queryForObject("SELECT ranking_state FROM challenges WHERE id=?", String.class, challenge);
    }

    private void like(UUID entry, UUID by) {
        db.jdbc.update("INSERT INTO entry_likes(id,entry_id,user_id) VALUES (?,?,?)", UUID.randomUUID(), entry, by);
    }

    private static UUID id(int n) {
        return UUID.fromString("00000000-0000-0000-0000-%012d".formatted(n));
    }
}
