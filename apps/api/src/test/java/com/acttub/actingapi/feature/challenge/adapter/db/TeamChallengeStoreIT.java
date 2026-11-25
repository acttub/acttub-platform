package com.acttub.actingapi.feature.challenge.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.Statement;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.challenge.app.ChallengeRepository;
import com.acttub.actingapi.feature.challenge.app.ChallengeRepository.Creation;
import com.acttub.actingapi.feature.challenge.app.ChallengeRepository.Draft;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 운영 개설({@code createTeam})이 요청 ID·선정일 검사를 권고 잠금 하나로 줄 세우는 것을 고정한다. 값 검증·재전송·선정일 겹침의
 * HTTP 응답은 {@code ChallengeIT#challengeManagement_featuredDayIsUniqueAndModerationPreservesThePeriod} 가 본다. 여기서는
 * 잠금의 키와 범위, 두 요청이 함께 올 때의 결과, 나가는 문장을 본다.
 */
@ChallengeStoreTest
class TeamChallengeStoreIT {

    private static final String LOCK = "SELECT pg_advisory_xact_lock(hashtext('challenge_team_create'))";

    @Autowired
    ChallengeStoreFixture db;

    @Autowired
    ChallengeRepository challenges;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");
    private final LocalDate day = LocalDate.parse("2026-11-25");
    private final Draft draft = new Draft("오늘의 대사", "창작", null, null, 7);

    @BeforeEach
    void setUp() {
        db.reset();
    }

    @Test
    @DisplayName("createTeam: 바깥 연결이 같은 권고 잠금(hashtext('challenge_team_create'))을 쥐고 있으면 그 뒤에서 기다린다. 트랜잭션이 끝나면 잠금도 풀린다")
    void createTeamWaitsBehindTheSameAdvisoryLock() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = db.probe()) {
            ChallengeStoreFixture.lock(probe, LOCK);
            Future<Creation> creating = pool.submit(() -> challenges.createTeam(UUID.randomUUID(), "a".repeat(64), draft, day, now));
            String waiting = db.awaitWaiting("pg_advisory_xact_lock");
            assertThat(db.jdbc.queryForList("""
                    SELECT wait_event FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%pg_advisory_xact_lock%'
                    """, String.class)).containsExactly("advisory");
            assertThat(db.count("challenges")).as("잠금 앞에서는 아무것도 적지 않는다").isZero();
            probe.rollback();

            assertThat(waiting.toLowerCase()).contains("pg_advisory_xact_lock(hashtext('challenge_team_create'))");
            assertThat(creating.get(20, TimeUnit.SECONDS).created()).isTrue();
            assertThat(tryLock(probe)).as("만든 트랜잭션이 끝났으니 잠금이 비어 있다").isTrue();
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("createTeam: 만드는 트랜잭션이 열려 있는 동안 다른 연결은 그 권고 잠금을 얻지 못한다")
    void theLockIsHeldUntilTheCreatingTransactionEnds() throws Exception {
        CountDownLatch created = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = db.probe()) {
            Future<Creation> holder = pool.submit(() -> db.inTransaction(() -> {
                Creation creation = challenges.createTeam(UUID.randomUUID(), "a".repeat(64), draft, null, now);
                created.countDown();
                ChallengeStoreFixture.await(release);
                return creation;
            }));
            ChallengeStoreFixture.await(created);
            assertThat(tryLock(probe)).isFalse();
            probe.rollback();
            release.countDown();
            assertThat(holder.get(20, TimeUnit.SECONDS).created()).isTrue();
            assertThat(tryLock(probe)).isTrue();
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("같은 선정일로 두 요청이 함께 오면 하나만 만들고 다른 하나는 422 featured_date_conflict 다 — 유니크 위반이 아니다")
    void twoRequestsForTheSameFeaturedDay() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 10; round++) {
                LocalDate featured = day.plusDays(round);
                CountDownLatch start = new CountDownLatch(1);
                Callable<Object> create = () -> {
                    start.await();
                    try {
                        return challenges.createTeam(UUID.randomUUID(), "a".repeat(64), draft, featured, now);
                    } catch (ApiException refused) {
                        return refused;
                    }
                };
                Future<Object> first = pool.submit(create);
                Future<Object> second = pool.submit(create);
                start.countDown();
                List<Object> results = List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));

                assertThat(results).as("round %d", round).filteredOn(Creation.class::isInstance).hasSize(1);
                assertThat(results).as("round %d", round).filteredOn(ApiException.class::isInstance).singleElement()
                        .satisfies(refused -> {
                            assertThat(((ApiException) refused).getMessage()).isEqualTo("featured_date_conflict");
                            assertThat(((ApiException) refused).status()).isEqualTo(422);
                        });
                assertThat(db.jdbc.queryForObject("SELECT count(*) FROM challenges WHERE featured_on=?", Integer.class, featured))
                        .as("round %d", round).isEqualTo(1);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("같은 요청 ID 로 두 요청이 함께 오면 하나가 만들고 다른 하나는 그 챌린지를 재전송으로 받는다")
    void twoRequestsWithTheSameRequestId() throws Exception {
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (int round = 0; round < 10; round++) {
                UUID request = UUID.randomUUID();
                CountDownLatch start = new CountDownLatch(1);
                Callable<Creation> create = () -> {
                    start.await();
                    return challenges.createTeam(request, "a".repeat(64), draft, null, now);
                };
                Future<Creation> first = pool.submit(create);
                Future<Creation> second = pool.submit(create);
                start.countDown();
                List<Creation> results = List.of(first.get(20, TimeUnit.SECONDS), second.get(20, TimeUnit.SECONDS));

                assertThat(results).as("round %d", round).extracting(Creation::created).containsExactlyInAnyOrder(true, false);
                assertThat(results.get(0).card()).as("round %d", round).isEqualTo(results.get(1).card());
                assertThat(db.jdbc.queryForObject("SELECT count(*) FROM challenges WHERE request_id=?", Integer.class, request))
                        .as("round %d", round).isEqualTo(1);
            }
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("createTeam 이 내는 문장: 권고 잠금이 맨 앞이고, 선정일이 있을 때만 그날을 센다. 재전송과 겹친 선정일은 적지 않는다")
    void statements() {
        UUID request = UUID.randomUUID();
        List<String> card = List.of("select challenges", "select challenge_entries");

        assertThat(db.statementsOf(() -> challenges.createTeam(request, "a".repeat(64), draft, day, now)))
                .containsExactlyElementsOf(concat(
                        List.of("advisory lock", "select challenges", "count challenges", "insert challenges"), card));
        assertThat(db.statementsOf(() -> challenges.createTeam(UUID.randomUUID(), "a".repeat(64), draft, null, now)))
                .containsExactlyElementsOf(concat(List.of("advisory lock", "select challenges", "insert challenges"), card));
        assertThat(db.statementsOf(() -> challenges.createTeam(request, "a".repeat(64), draft, day, now)))
                .as("재전송")
                .containsExactlyElementsOf(concat(List.of("advisory lock", "select challenges"), card));
        assertThat(db.statementsOf(() -> {
            try {
                challenges.createTeam(UUID.randomUUID(), "a".repeat(64), draft, day, now);
            } catch (ApiException conflict) {
                assertThat(conflict.getMessage()).isEqualTo("featured_date_conflict");
            }
        })).as("겹친 선정일").containsExactly("advisory lock", "select challenges", "count challenges");
        assertThat(db.count("challenges")).isEqualTo(2);
    }

    private static List<String> concat(List<String> head, List<String> tail) {
        List<String> all = new ArrayList<>(head);
        all.addAll(tail);
        return all;
    }

    /** 바깥 연결이 그 잠금을 바로 얻을 수 있는가. 얻었으면 되돌려 푼다. */
    private static boolean tryLock(Connection probe) throws Exception {
        try (Statement statement = probe.createStatement();
                ResultSet result = statement.executeQuery("SELECT pg_try_advisory_xact_lock(hashtext('challenge_team_create'))")) {
            result.next();
            boolean acquired = result.getBoolean(1);
            probe.rollback();
            return acquired;
        }
    }
}
