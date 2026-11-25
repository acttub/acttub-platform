package com.acttub.actingapi.feature.challenge.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.challenge.app.ChallengeRepository;
import com.acttub.actingapi.feature.challenge.app.EntryRepository;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.Creation;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.NewEntry;
import com.acttub.actingapi.feature.challenge.app.ReactionRepository;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 챌린지 행을 잠그고 세는 연산들이 서로 줄을 서는 순서와 겹칠 때의 결과를 고정한다: 참여작 올리기(사용자 → 챌린지 → 영상),
 * 마감 정산, 운영자 조치, 챌린지 지우기, 마감 뒤 좋아요. 저장소를 네이티브 SQL 에서 JPA 로 옮기는 동안 이 테스트는 고치지
 * 않는다(apps/api/CONTRACT.md §5-9).
 */
@ChallengeStoreTest
class ChallengeLockOrderIT {

    @Autowired
    ChallengeStoreFixture db;

    @Autowired
    EntryRepository entries;

    @Autowired
    ChallengeRepository challenges;

    @Autowired
    ReactionRepository reactions;

    @Autowired
    ChallengeSettlement settlement;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");
    private final Instant deadline = now.plus(Duration.ofDays(6));
    private UUID host;
    private UUID actor;
    private UUID challenge;

    @BeforeEach
    void setUp() {
        db.reset();
        host = db.member("주최자");
        actor = db.member("배우");
        challenge = db.memberChallenge(host, now.minus(Duration.ofDays(1)), deadline);
    }

    @Test
    @DisplayName("참여작 올리기는 사용자 → 챌린지 → 영상 순서로 FOR UPDATE 를 잡는다 — 뒤의 행에서 기다리는 동안 앞의 행은 이미 잡고 있고 그 뒤의 행은 잡지 않았다")
    void createLocksTheUserThenTheChallengeThenTheVideo() throws Exception {
        UUID video = db.video(actor);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = db.probe()) {
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM users WHERE id=? FOR KEY SHARE", actor);
            Future<Creation> onUser = pool.submit(() -> create(actor, video, now));
            String waitingOnUser = db.awaitWaiting("from users");
            assertThat(db.locked("challenges", challenge)).isFalse();
            probe.rollback();
            assertThat(onUser.get(20, TimeUnit.SECONDS).created()).isTrue();

            UUID second = db.video(actor);
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM challenges WHERE id=? FOR KEY SHARE", challenge);
            Future<Creation> onChallenge = pool.submit(() -> create(actor, second, now));
            String waitingOnChallenge = db.awaitWaiting("from challenges");
            assertThat(db.locked("users", actor)).isTrue();
            assertThat(db.locked("videos", second)).isFalse();
            probe.rollback();
            assertThat(onChallenge.get(20, TimeUnit.SECONDS).created()).isTrue();

            UUID third = db.video(actor);
            ChallengeStoreFixture.lock(probe, "SELECT 1 FROM videos WHERE id=? FOR KEY SHARE", third);
            Future<Creation> onVideo = pool.submit(() -> create(actor, third, now));
            String waitingOnVideo = db.awaitWaiting("from videos");
            assertThat(db.locked("users", actor)).isTrue();
            assertThat(db.locked("challenges", challenge)).isTrue();
            probe.rollback();
            assertThat(onVideo.get(20, TimeUnit.SECONDS).created()).isTrue();

            for (String waiting : List.of(waitingOnUser, waitingOnChallenge, waitingOnVideo)) {
                assertThat(waiting.toLowerCase()).contains("for update").doesNotContain("no key");
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("하루 한도의 마지막 한 자리를 같은 회원의 두 요청이 함께 노리면 하나만 올라가고 다른 하나는 429 daily_entry_limit 다")
    void twoCreatesRacingForTheLastDailySlot() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 10; round++) {
                UUID owner = db.member("배우 " + round);
                db.entry(challenge, owner, now.minusSeconds(120));
                db.entry(challenge, owner, now.minusSeconds(60));
                UUID one = db.video(owner);
                UUID other = db.video(owner);
                CountDownLatch start = new CountDownLatch(1);
                List<Future<Object>> racing = List.of(pool.submit(racer(start, owner, one)), pool.submit(racer(start, owner, other)));
                start.countDown();
                List<Object> results = List.of(racing.get(0).get(20, TimeUnit.SECONDS), racing.get(1).get(20, TimeUnit.SECONDS));

                assertThat(results).as("round %d", round).filteredOn(Creation.class::isInstance).hasSize(1);
                assertThat(results).as("round %d", round).filteredOn(ApiException.class::isInstance).singleElement()
                        .satisfies(refused -> {
                            assertThat(((ApiException) refused).status()).isEqualTo(429);
                            assertThat(((ApiException) refused).getMessage()).isEqualTo("daily_entry_limit");
                        });
                assertThat(db.jdbc.queryForObject("SELECT count(*) FROM challenge_entries WHERE user_id=?", Integer.class, owner))
                        .as("round %d", round).isEqualTo(3);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("정산이 챌린지 행을 먼저 잡으면 참여작 올리기는 그 행에서 기다렸다가 422 challenge_closed 를 받는다")
    void aCreateBehindTheSettlementIsRefused() throws Exception {
        UUID video = db.video(actor);
        CountDownLatch settled = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> settling = pool.submit(() -> db.inTransaction(() -> {
                settlement.settle(challenge, deadline);
                settled.countDown();
                ChallengeStoreFixture.await(release);
            }));
            ChallengeStoreFixture.await(settled);
            Future<Object> creating = pool.submit(() -> attempt(() -> create(actor, video, deadline)));
            db.awaitWaiting("from challenges");
            release.countDown();
            settling.get(20, TimeUnit.SECONDS);

            assertThat(creating.get(20, TimeUnit.SECONDS)).isInstanceOfSatisfying(ApiException.class, refused -> {
                assertThat(refused.status()).isEqualTo(422);
                assertThat(refused.getMessage()).isEqualTo("challenge_closed");
            });
        } finally {
            pool.shutdownNow();
        }
        assertThat(db.count("challenge_entries")).isZero();
        assertThat(state()).isEqualTo("final");
    }

    @Test
    @DisplayName("마감 전에 올리기가 챌린지 행을 먼저 잡으면 정산은 그 커밋을 기다렸다가 그 참여작까지 집계한다")
    void aSettlementBehindACreateCountsTheNewEntry() throws Exception {
        UUID video = db.video(actor);
        CountDownLatch created = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Creation> creating = pool.submit(() -> db.inTransaction(() -> {
                Creation creation = entries.create(actor, challenge, UUID.randomUUID(), "a".repeat(64),
                        new NewEntry(video, null, "public", false), deadline.minusSeconds(1));
                created.countDown();
                ChallengeStoreFixture.await(release);
                return creation;
            }));
            ChallengeStoreFixture.await(created);
            Future<?> settling = pool.submit(() -> db.inTransaction(() -> settlement.settle(challenge, deadline)));
            db.awaitWaiting("from challenges");
            assertThat(state()).isNull();
            release.countDown();
            UUID entry = creating.get(20, TimeUnit.SECONDS).entry().id();
            settling.get(20, TimeUnit.SECONDS);

            assertThat(db.jdbc.queryForMap("SELECT final_like_count,final_eligible,final_rank FROM challenge_entries WHERE id=?", entry))
                    .containsEntry("final_like_count", 0L).containsEntry("final_eligible", true).containsEntry("final_rank", 1);
        } finally {
            pool.shutdownNow();
        }
        assertThat(state()).isEqualTo("final");
    }

    @Test
    @DisplayName("챌린지 지우기가 먼저 잡으면 올리기는 기다렸다가 404 challenge_not_found 를 받는다. 올리기가 먼저면 지우기는 기다렸다가 422 challenge_has_entries 를 받는다")
    void deletingTheChallengeAgainstACreate() throws Exception {
        UUID video = db.video(actor);
        CountDownLatch done = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Boolean> deleting = pool.submit(() -> db.inTransaction(() -> {
                boolean deleted = challenges.delete(host, challenge, now);
                done.countDown();
                ChallengeStoreFixture.await(release);
                return deleted;
            }));
            ChallengeStoreFixture.await(done);
            Future<Object> creating = pool.submit(() -> attempt(() -> create(actor, video, now)));
            db.awaitWaiting("from challenges");
            release.countDown();

            assertThat(deleting.get(20, TimeUnit.SECONDS)).isTrue();
            assertThat(creating.get(20, TimeUnit.SECONDS)).isInstanceOfSatisfying(ApiException.class, refused -> {
                assertThat(refused.status()).isEqualTo(404);
                assertThat(refused.getMessage()).isEqualTo("challenge_not_found");
            });
            assertThat(db.count("challenge_entries")).isZero();

            UUID open = db.memberChallenge(host, now.minus(Duration.ofDays(1)), deadline);
            CountDownLatch created = new CountDownLatch(1);
            CountDownLatch releaseCreate = new CountDownLatch(1);
            Future<Creation> first = pool.submit(() -> db.inTransaction(() -> {
                Creation creation = entries.create(actor, open, UUID.randomUUID(), "a".repeat(64),
                        new NewEntry(video, null, "public", false), now);
                created.countDown();
                ChallengeStoreFixture.await(releaseCreate);
                return creation;
            }));
            ChallengeStoreFixture.await(created);
            Future<Object> late = pool.submit(() -> attempt(() -> challenges.delete(host, open, now)));
            String waiting = db.awaitWaiting("from challenges");
            releaseCreate.countDown();

            assertThat(waiting.toLowerCase()).contains("for update").doesNotContain("no key");
            assertThat(first.get(20, TimeUnit.SECONDS).created()).isTrue();
            assertThat(late.get(20, TimeUnit.SECONDS)).isInstanceOfSatisfying(ApiException.class, refused -> {
                assertThat(refused.status()).isEqualTo(422);
                assertThat(refused.getMessage()).isEqualTo("challenge_has_entries");
            });
            assertThat(db.jdbc.queryForObject("SELECT deleted_at IS NULL FROM challenges WHERE id=?", Boolean.class, open)).isTrue();
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("운영자 조치(review)가 먼저 잡으면 올리기는 기다렸다가 404 challenge_not_found 를 받는다")
    void aCreateBehindModerationIsRefused() throws Exception {
        UUID video = db.video(actor);
        CountDownLatch moderated = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<?> moderating = pool.submit(() -> db.inTransaction(() -> {
                challenges.moderate(challenge, "review", now);
                moderated.countDown();
                ChallengeStoreFixture.await(release);
            }));
            ChallengeStoreFixture.await(moderated);
            Future<Object> creating = pool.submit(() -> attempt(() -> create(actor, video, now)));
            db.awaitWaiting("from challenges");
            release.countDown();
            moderating.get(20, TimeUnit.SECONDS);

            assertThat(creating.get(20, TimeUnit.SECONDS)).isInstanceOfSatisfying(ApiException.class, refused -> {
                assertThat(refused.status()).isEqualTo(404);
                assertThat(refused.getMessage()).isEqualTo("challenge_not_found");
            });
        } finally {
            pool.shutdownNow();
        }
        assertThat(db.count("challenge_entries")).isZero();
    }

    @Test
    @DisplayName("운영자 조치는 챌린지 행을 잡은 뒤 마감 정산까지 한 트랜잭션에서 한다 — review 를 풀면 기다리던 순위가 확정된다")
    void moderationSettlesInTheSameTransaction() {
        UUID entry = db.entry(challenge, actor, now);
        challenges.moderate(challenge, "review", deadline);
        assertThat(state()).as("review 인 동안은 집계만 한다").isEqualTo("pending");
        assertThat(db.jdbc.queryForObject("SELECT final_rank FROM challenge_entries WHERE id=?", Integer.class, entry)).isNull();

        challenges.moderate(challenge, "visible", deadline.plusSeconds(60));

        assertThat(state()).isEqualTo("final");
        assertThat(db.jdbc.queryForObject("SELECT final_rank FROM challenge_entries WHERE id=?", Integer.class, entry)).isEqualTo(1);
        assertThat(db.jdbc.queryForObject("SELECT moderation FROM challenges WHERE id=?", String.class, challenge))
                .as("확정이 조치를 덮어쓰지 않는다").isEqualTo("visible");
    }

    @Test
    @DisplayName("마감 뒤의 좋아요는 마감 집계가 먼저다 — 좋아요는 남지만 마감 좋아요 수와 순위에는 들지 않는다")
    void aLikeAfterTheDeadlineSettlesFirst() {
        UUID entry = db.entry(challenge, actor, now);
        UUID fan = db.member("팬");

        reactions.like(fan, entry, true, deadline);

        assertThat(db.jdbc.queryForObject("SELECT count(*) FROM entry_likes WHERE entry_id=?", Integer.class, entry)).isEqualTo(1);
        assertThat(db.jdbc.queryForObject("SELECT final_like_count FROM challenge_entries WHERE id=?", Long.class, entry)).isZero();
        assertThat(state()).isEqualTo("final");
    }

    private Creation create(UUID owner, UUID video, Instant at) {
        return entries.create(owner, challenge, UUID.randomUUID(), "a".repeat(64), new NewEntry(video, null, "public", false), at);
    }

    private Callable<Object> racer(CountDownLatch start, UUID owner, UUID video) {
        return () -> {
            start.await();
            return attempt(() -> create(owner, video, now));
        };
    }

    /** 결과나, 거절이면 그 예외. */
    private static Object attempt(Callable<?> call) {
        try {
            return call.call();
        } catch (ApiException refused) {
            return refused;
        } catch (Exception other) {
            throw new IllegalStateException(other);
        }
    }

    private String state() {
        return db.jdbc.queryForObject("SELECT ranking_state FROM challenges WHERE id=?", String.class, challenge);
    }
}
