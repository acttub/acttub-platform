package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.reading.app.SessionRatingStore;
import com.acttub.actingapi.feature.reading.app.SessionRatingStore.Outcome;
import com.acttub.actingapi.feature.reading.app.SessionRatingStore.Rating;
import com.acttub.actingapi.feature.reading.app.SessionRatingStore.Saved;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 리딩 회차 평가 저장소가 내는 결과·잠금·경합·문장을 고정한다. HTTP 쪽 검증·응답 모양·회차와 대본 삭제·탈퇴·이관은
 * {@link ReadingSessionRatingIT} 가 본다. 여기서는 그 테스트가 밟지 않는 시각의 정밀도, 닫힌 계정, 사람 → 대본 → 회차 순서의
 * 잠금, 잠금을 기다린 뒤 다시 보는 회차, 두 요청이 함께 남길 때의 결과, 포트 메서드마다 나가는 문장을 본다.
 *
 * <p>저장소를 네이티브 SQL 에서 JPA 로 옮길 때 문장 테스트 한 곳만 달라졌다 — upsert 의 {@code RETURNING} 을 같은
 * 트랜잭션의 다시 읽기로 나눠 저장할 때 문장이 하나 늘었다. 결과·잠금·경합 테스트는 고치지 않았다.
 */
class SessionRatingStoreIT extends ReadingRepositoryFixture {

    @Autowired
    SessionRatingStore ratings;

    private UUID owner;
    private UUID script;
    private UUID session;

    @BeforeEach
    void setUp() {
        owner = member();
        script = script(owner);
        UUID nina = character(script, "니나", 0);
        UUID line = line(script, 1, "dialogue", nina, "안녕");
        session = session(owner, script, line, line, nina);
    }

    @Test
    @DisplayName("save: 처음이면 행을 만들고 낸 시각은 마이크로초로 반올림한 저장 값이다. 다른 요청 id 로 다시 남기면 같은 행을 덮어쓰고 한 줄이 없으면 비운다")
    void saveCreatesThenOverwritesTheSameRow() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();

        assertThat(ratings.save(owner, session, first, "good", "좋았어요", now.plusNanos(123_456_789)))
                .isEqualTo(new Saved(Outcome.SAVED, new Rating("good", "좋았어요", now.plus(123_457, ChronoUnit.MICROS))));
        UUID rowId = jdbc.queryForObject("SELECT id FROM reading_session_ratings", UUID.class);

        assertThat(ratings.save(owner, session, second, "bad", null, now.plusSeconds(60)))
                .isEqualTo(new Saved(Outcome.SAVED, new Rating("bad", null, now.plusSeconds(60))));

        assertThat(jdbc.queryForMap("SELECT id,session_id,user_id,rating,comment,request_id FROM reading_session_ratings"))
                .containsEntry("id", rowId).containsEntry("session_id", session).containsEntry("user_id", owner)
                .containsEntry("rating", "bad").containsEntry("comment", null).containsEntry("request_id", second);
        assertThat(instant("SELECT created_at FROM reading_session_ratings")).isEqualTo(now.plus(123_457, ChronoUnit.MICROS));
        assertThat(instant("SELECT updated_at FROM reading_session_ratings")).isEqualTo(now.plusSeconds(60));
    }

    @Test
    @DisplayName("save: 같은 요청 id 에 같은 본문이면 REPLAYED 로 저장된 값을 내고 아무것도 바꾸지 않는다. 본문이 다르면 MISMATCH 다")
    void saveReplaysTheSameRequest() {
        UUID request = UUID.randomUUID();
        ratings.save(owner, session, request, "good", "좋았어요", now);

        assertThat(ratings.save(owner, session, request, "good", "좋았어요", now.plusSeconds(60)))
                .isEqualTo(new Saved(Outcome.REPLAYED, new Rating("good", "좋았어요", now)));
        assertThat(ratings.save(owner, session, request, "bad", "좋았어요", now.plusSeconds(60)))
                .isEqualTo(new Saved(Outcome.MISMATCH, null));
        assertThat(ratings.save(owner, session, request, "good", null, now.plusSeconds(60)))
                .isEqualTo(new Saved(Outcome.MISMATCH, null));

        assertThat(jdbc.queryForMap("SELECT rating,comment FROM reading_session_ratings"))
                .containsEntry("rating", "good").containsEntry("comment", "좋았어요");
        assertThat(instant("SELECT updated_at FROM reading_session_ratings")).isEqualTo(now);
    }

    @Test
    @DisplayName("save: 없는 회차·남의 회차는 SESSION_NOT_FOUND, 활성이 아닌 계정은 INACTIVE 다. 어느 쪽도 행을 만들지 않는다")
    void saveRefusesMissingSessionsAndClosedAccounts() {
        UUID stranger = member();
        UUID closed = member();
        UUID closedScript = script(closed);
        UUID closedLine = line(closedScript, 1, "dialogue", character(closedScript, "니나", 0), "안녕");
        UUID closedSession = session(closed, closedScript, closedLine, closedLine);
        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", closed);

        assertThat(ratings.save(owner, UUID.randomUUID(), UUID.randomUUID(), "good", null, now))
                .isEqualTo(new Saved(Outcome.SESSION_NOT_FOUND, null));
        assertThat(ratings.save(stranger, session, UUID.randomUUID(), "good", null, now))
                .isEqualTo(new Saved(Outcome.SESSION_NOT_FOUND, null));
        assertThat(ratings.save(closed, closedSession, UUID.randomUUID(), "good", null, now))
                .isEqualTo(new Saved(Outcome.INACTIVE, null));
        assertThat(ratings.save(UUID.randomUUID(), session, UUID.randomUUID(), "good", null, now))
                .isEqualTo(new Saved(Outcome.INACTIVE, null));

        assertThat(count("reading_session_ratings")).isZero();
    }

    @Test
    @DisplayName("mine: 그 회차에 내가 남긴 평가를 낸다. 없으면 null 이고 남의 평가는 보이지 않는다")
    void mineReadsOnlyMyRating() {
        assertThat(ratings.mine(owner, session)).isNull();
        ratings.save(owner, session, UUID.randomUUID(), "good", "좋았어요", now);

        assertThat(ratings.mine(owner, session)).isEqualTo(new Rating("good", "좋았어요", now));
        assertThat(ratings.mine(member(), session)).isNull();
        assertThat(ratings.mine(owner, UUID.randomUUID())).isNull();
    }

    @Test
    @DisplayName("save 는 사람 → 대본 → 회차 행을 차례로 FOR UPDATE 로 잡는다 — 바깥 연결이 그 행을 FOR KEY SHARE 로 잡고 있으면 그 뒤에서 기다린다")
    void saveLocksTheUserThenTheScriptThenTheSession() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            for (String[] step : new String[][] {
                {"users", owner.toString()}, {"scripts", script.toString()}, {"reading_sessions", session.toString()}}) {
                run(probe, "SELECT 1 FROM " + step[0] + " WHERE id=? FOR KEY SHARE", UUID.fromString(step[1]));
                Future<Saved> blocked = pool.submit(() ->
                        ratings.save(owner, session, UUID.randomUUID(), "good", null, now));
                String waiting = awaitWaiting("from " + step[0]);
                probe.rollback();

                assertThat(waiting).as(step[0]).startsWith("select").contains("for update");
                assertThat(blocked.get(20, TimeUnit.SECONDS).outcome()).isEqualTo(Outcome.SAVED);
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(count("reading_session_ratings")).isEqualTo(1);
    }

    @Test
    @DisplayName("회차를 지우는 사이에 온 평가는 회차 행에서 기다렸다가 다시 본다 — 커밋되면 SESSION_NOT_FOUND 이고 아무것도 남지 않는다. 되돌리면 저장한다")
    void saveRechecksTheSessionAfterWaiting() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            run(probe, "DELETE FROM reading_sessions WHERE id=?", session);
            Future<Saved> rolledBack = pool.submit(() ->
                    ratings.save(owner, session, UUID.randomUUID(), "good", null, now));
            awaitWaiting("from reading_sessions");
            probe.rollback();
            assertThat(rolledBack.get(20, TimeUnit.SECONDS).outcome()).isEqualTo(Outcome.SAVED);

            jdbc.update("DELETE FROM reading_session_ratings");
            run(probe, "DELETE FROM reading_sessions WHERE id=?", session);
            Future<Saved> committed = pool.submit(() ->
                    ratings.save(owner, session, UUID.randomUUID(), "good", null, now));
            awaitWaiting("from reading_sessions");
            probe.commit();
            assertThat(committed.get(20, TimeUnit.SECONDS)).isEqualTo(new Saved(Outcome.SESSION_NOT_FOUND, null));
        } finally {
            pool.shutdownNow();
        }
        assertThat(count("reading_session_ratings")).isZero();
    }

    @Test
    @DisplayName("두 요청이 함께 평가를 남기면 뒤의 것이 사람 행에서 앞의 커밋을 기다렸다가 덮어쓴다. 앞의 트랜잭션 안에서 다시 읽어도 방금 쓴 값이고 행은 하나다")
    void twoRatingsAtOnce() throws Exception {
        CountDownLatch firstWrote = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Saved> first = pool.submit(() -> inTransaction(() -> {
                Saved saved = ratings.save(owner, session, UUID.randomUUID(), "good", "먼저", now);
                firstWrote.countDown();
                await(release);
                assertThat(ratings.mine(owner, session)).as("같은 트랜잭션에서 다시 읽어도 방금 쓴 값이다")
                        .isEqualTo(new Rating("good", "먼저", now));
                return saved;
            }));
            await(firstWrote);
            Future<Saved> second = pool.submit(() ->
                    ratings.save(owner, session, UUID.randomUUID(), "bad", "나중", now.plusSeconds(5)));
            assertThat(awaitWaiting("from users")).contains("for update");
            release.countDown();

            assertThat(first.get(20, TimeUnit.SECONDS))
                    .isEqualTo(new Saved(Outcome.SAVED, new Rating("good", "먼저", now)));
            assertThat(second.get(20, TimeUnit.SECONDS))
                    .isEqualTo(new Saved(Outcome.SAVED, new Rating("bad", "나중", now.plusSeconds(5))));
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT comment FROM reading_session_ratings", String.class)).containsExactly("나중");
    }

    @Test
    @DisplayName("포트 메서드마다 나가는 문장: save 는 잠금 셋과 읽기 둘 뒤에 upsert 와 쓴 행 다시 읽기다. 재전송은 쓰지 않고, 닫힌 계정·없는 회차는 거기서 멈춘다. mine 은 조회 하나다")
    void eachPortMethodSendsTheseStatements() {
        UUID request = UUID.randomUUID();

        assertThat(statementsOf(() -> ratings.save(owner, session, request, "good", null, now))).containsExactly(
                "select users for update", "select reading_sessions", "select scripts for update",
                "select reading_sessions for update", "select reading_session_ratings",
                "insert reading_session_ratings on conflict", "select reading_session_ratings");
        assertThat(statementsOf(() -> ratings.save(owner, session, request, "good", null, now))).containsExactly(
                "select users for update", "select reading_sessions", "select scripts for update",
                "select reading_sessions for update", "select reading_session_ratings");
        assertThat(statementsOf(() -> ratings.save(owner, UUID.randomUUID(), request, "good", null, now)))
                .containsExactly("select users for update", "select reading_sessions");
        assertThat(statementsOf(() -> ratings.save(UUID.randomUUID(), session, request, "good", null, now)))
                .containsExactly("select users for update");
        assertThat(statementsOf(() -> ratings.mine(owner, session))).containsExactly("select reading_session_ratings");
    }
}
