package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.reading.app.ScriptCocreateRepository;
import com.acttub.actingapi.feature.reading.app.ScriptCocreateRepository.Row;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 찍을 대사 같이 만들기 저장소가 내는 결과·잠금·경합·문장을 고정한다. 만들기에서 확정까지의 HTTP 흐름은
 * {@link ScriptCocreateIT} 가 본다. 여기서는 그 테스트가 밟지 않는 조건부 갱신마다의 경계(버전·확정·수정 횟수·멈춘 수정),
 * 시각의 정밀도, 남의 줄, 같은 요청 id 를 두 요청이 함께 넣을 때와 같은 버전을 함께 고칠 때의 결과, 사람 → 생성 행 순서의 잠금,
 * 포트 메서드마다 나가는 문장을 본다.
 */
class ScriptCocreateRepositoryIT extends ReadingRepositoryFixture {

    @Autowired
    ScriptCocreateRepository cocreations;

    private UUID owner;

    @BeforeEach
    void setUp() {
        owner = member();
    }

    @Test
    @DisplayName("insertPending: 만드는 중인 줄을 넣는다(버전 없음, 지금 버전 0, 수정 0). 같은 (사람, 요청 id) 는 넣지 않고 false 다. 다른 사람의 같은 요청 id 는 넣는다")
    void insertPendingCreatesOncePerRequest() {
        UUID id = UUID.randomUUID();
        UUID request = UUID.randomUUID();

        assertThat(cocreations.insertPending(id, owner, request, now.plusNanos(123_456_789))).isTrue();
        assertThat(cocreations.insertPending(UUID.randomUUID(), owner, request, now.plusSeconds(5))).isFalse();
        assertThat(cocreations.insertPending(UUID.randomUUID(), member(), request, now)).isTrue();

        Instant stamp = now.plus(123_457, ChronoUnit.MICROS);
        assertThat(cocreations.find(owner, id)).isEqualTo(new Row(id, request, null, null, 0, 0, null, null, null, stamp));
        assertThat(cocreations.find(owner, id).ready()).isFalse();
        assertThat(instant("SELECT updated_at FROM script_cocreations WHERE id=?", id)).isEqualTo(stamp);
        assertThat(count("script_cocreations")).isEqualTo(2);
    }

    @Test
    @DisplayName("find·findByRequest: 내 줄의 모든 칸을 낸다. 없는 줄과 남의 줄은 null 이다")
    void findReadsEveryColumnOfMyRow() {
        UUID request = UUID.randomUUID();
        UUID id = ready(owner, request);
        UUID script = script(owner);
        jdbc.update("UPDATE script_cocreations SET revisions_used=2, busy_since=?, script_id=? WHERE id=?",
                utc(now.plusSeconds(9)), script, id);
        Row row = new Row(id, request, "{\"조건\":1}", "[\"첫 버전\"]", 1, 2, "gemini-test", now.plusSeconds(9), script, now);

        assertThat(cocreations.find(owner, id)).isEqualTo(row);
        assertThat(cocreations.findByRequest(owner, request)).isEqualTo(row);
        assertThat(cocreations.find(owner, id).ready()).isTrue();
        assertThat(cocreations.find(member(), id)).isNull();
        assertThat(cocreations.find(owner, UUID.randomUUID())).isNull();
        assertThat(cocreations.findByRequest(member(), request)).isNull();
        assertThat(cocreations.findByRequest(owner, UUID.randomUUID())).isNull();
    }

    @Test
    @DisplayName("complete: 조건·버전·모델을 적고 지금 버전을 1 로 둔다. deletePending 은 아직 만드는 중인 줄만 지운다")
    void completeFillsTheFirstVersionAndDeletePendingSparesIt() {
        UUID pending = UUID.randomUUID();
        UUID done = UUID.randomUUID();
        cocreations.insertPending(pending, owner, UUID.randomUUID(), now);
        cocreations.insertPending(done, owner, UUID.randomUUID(), now);

        cocreations.complete(done, "{\"조건\":1}", "[\"첫 버전\"]", "gemini-test", now.plusSeconds(3));
        cocreations.deletePending(pending);
        cocreations.deletePending(done);

        assertThat(jdbc.queryForList("SELECT id FROM script_cocreations", UUID.class)).containsExactly(done);
        assertThat(jdbc.queryForMap("SELECT conditions,versions,current_version,model,revisions_used FROM script_cocreations"))
                .containsEntry("conditions", "{\"조건\":1}").containsEntry("versions", "[\"첫 버전\"]")
                .containsEntry("current_version", 1).containsEntry("model", "gemini-test").containsEntry("revisions_used", 0);
        assertThat(instant("SELECT updated_at FROM script_cocreations")).isEqualTo(now.plusSeconds(3));
        assertThat(instant("SELECT created_at FROM script_cocreations")).isEqualTo(now);
    }

    @Test
    @DisplayName("countSince: 그 시각부터(같은 시각 포함) 내가 만든 줄을 만드는 중인 것까지 센다. recentConditions 는 다 만든 줄의 조건을 최근 순으로 limit 개 낸다")
    void countSinceAndRecentConditions() {
        UUID oldest = ready(owner, UUID.randomUUID());
        jdbc.update("UPDATE script_cocreations SET created_at=?, conditions='오래된' WHERE id=?", utc(now.minusSeconds(60)), oldest);
        UUID middle = ready(owner, UUID.randomUUID());
        jdbc.update("UPDATE script_cocreations SET conditions='가운데' WHERE id=?", middle);
        UUID newest = ready(owner, UUID.randomUUID());
        jdbc.update("UPDATE script_cocreations SET created_at=?, conditions='최근' WHERE id=?", utc(now.plusSeconds(60)), newest);
        cocreations.insertPending(UUID.randomUUID(), owner, UUID.randomUUID(), now.plusSeconds(120));
        ready(member(), UUID.randomUUID());

        assertThat(cocreations.countSince(owner, now)).isEqualTo(3);
        assertThat(cocreations.countSince(owner, now.plusNanos(1_000))).isEqualTo(2);
        assertThat(cocreations.countSince(owner, now.minusSeconds(3600))).isEqualTo(4);
        assertThat(cocreations.recentConditions(owner, 10)).containsExactly("최근", "가운데", "오래된");
        assertThat(cocreations.recentConditions(owner, 2)).containsExactly("최근", "가운데");
        assertThat(cocreations.recentConditions(UUID.randomUUID(), 10)).isEmpty();
    }

    @Test
    @DisplayName("claim: 지금 버전이 맞고 확정 전이고 수정이 남았고 다른 수정이 없거나 멈춘 것일 때만 표시를 남긴다. 그 밖에는 false 이고 아무것도 바꾸지 않는다")
    void claimOnlyWhenEveryConditionHolds() {
        UUID id = ready(owner, UUID.randomUUID());
        Instant stale = now.minusSeconds(120);

        assertThat(cocreations.claim(owner, id, 2, 3, now, stale)).as("지금 버전이 아니다").isFalse();
        assertThat(cocreations.claim(member(), id, 1, 3, now, stale)).as("남의 줄").isFalse();
        assertThat(cocreations.claim(owner, id, 1, 0, now, stale)).as("수정을 다 썼다").isFalse();
        assertThat(jdbc.queryForObject("SELECT busy_since FROM script_cocreations WHERE id=?", Object.class, id)).isNull();

        assertThat(cocreations.claim(owner, id, 1, 3, now.plusNanos(1_500), stale)).isTrue();
        assertThat(instant("SELECT busy_since FROM script_cocreations WHERE id=?", id)).isEqualTo(now.plus(2, ChronoUnit.MICROS));
        assertThat(instant("SELECT updated_at FROM script_cocreations WHERE id=?", id)).isEqualTo(now.plus(2, ChronoUnit.MICROS));

        assertThat(cocreations.claim(owner, id, 1, 3, now.plusSeconds(10), stale)).as("다른 수정이 도는 중").isFalse();
        assertThat(cocreations.claim(owner, id, 1, 3, now.plusSeconds(10), now.plus(2, ChronoUnit.MICROS)))
                .as("표시한 시각이 기준과 같으면 아직 멈춘 것이 아니다").isFalse();
        assertThat(cocreations.claim(owner, id, 1, 3, now.plusSeconds(10), now.plusSeconds(1))).as("멈춘 수정").isTrue();

        cocreations.release(id);
        jdbc.update("UPDATE script_cocreations SET script_id=? WHERE id=?", script(owner), id);
        assertThat(cocreations.claim(owner, id, 1, 3, now, stale)).as("확정했다").isFalse();

        UUID pending = UUID.randomUUID();
        cocreations.insertPending(pending, owner, UUID.randomUUID(), now);
        assertThat(cocreations.claim(owner, pending, 0, 3, now, stale)).as("아직 만드는 중").isFalse();
    }

    @Test
    @DisplayName("appendVersion: 수정 중인 줄에 버전을 더하고 횟수를 하나 올리고 표시를 푼다. 수정 중이 아니거나 확정했으면 409 sample_script_version_conflict 이고 그대로다. release 는 표시만 푼다")
    void appendVersionNeedsTheClaim() {
        UUID id = ready(owner, UUID.randomUUID());

        assertThatThrownBy(() -> cocreations.appendVersion(id, "[\"첫\",\"둘\"]", 2, now))
                .isInstanceOfSatisfying(ApiException.class, failure -> {
                    assertThat(failure.getMessage()).isEqualTo("sample_script_version_conflict");
                });
        cocreations.claim(owner, id, 1, 3, now, now.minusSeconds(120));
        cocreations.appendVersion(id, "[\"첫\",\"둘\"]", 2, now.plusSeconds(7));

        assertThat(jdbc.queryForMap("SELECT versions,current_version,revisions_used,busy_since FROM script_cocreations WHERE id=?", id))
                .containsEntry("versions", "[\"첫\",\"둘\"]").containsEntry("current_version", 2)
                .containsEntry("revisions_used", 1).containsEntry("busy_since", null);
        assertThat(instant("SELECT updated_at FROM script_cocreations WHERE id=?", id)).isEqualTo(now.plusSeconds(7));

        cocreations.claim(owner, id, 2, 3, now, now.minusSeconds(120));
        cocreations.release(id);
        assertThat(jdbc.queryForMap("SELECT revisions_used,busy_since FROM script_cocreations WHERE id=?", id))
                .containsEntry("revisions_used", 1).containsEntry("busy_since", null);

        jdbc.update("UPDATE script_cocreations SET busy_since=now(), script_id=? WHERE id=?", script(owner), id);
        assertThatThrownBy(() -> cocreations.appendVersion(id, "[]", 3, now)).isInstanceOf(ApiException.class);
        assertThat(jdbc.queryForObject("SELECT current_version FROM script_cocreations WHERE id=?", Integer.class, id)).isEqualTo(2);
    }

    @Test
    @DisplayName("restore: 수정 중이 아니고 확정 전인 내 줄의 지금 버전을 바꾼다. 수정 중·확정·만드는 중·남의 줄이면 false 다. linkScript 는 내 줄에 대본을 잇는다")
    void restoreAndLinkScript() {
        UUID id = ready(owner, UUID.randomUUID());

        assertThat(cocreations.restore(member(), id, 3, now)).isFalse();
        assertThat(cocreations.restore(owner, id, 3, now.plusSeconds(4))).isTrue();
        assertThat(jdbc.queryForObject("SELECT current_version FROM script_cocreations WHERE id=?", Integer.class, id)).isEqualTo(3);
        assertThat(instant("SELECT updated_at FROM script_cocreations WHERE id=?", id)).isEqualTo(now.plusSeconds(4));

        cocreations.claim(owner, id, 3, 3, now, now.minusSeconds(120));
        assertThat(cocreations.restore(owner, id, 1, now)).as("수정 중").isFalse();
        cocreations.release(id);

        UUID script = script(owner);
        cocreations.linkScript(member(), id, script, now);
        assertThat(jdbc.queryForObject("SELECT script_id FROM script_cocreations WHERE id=?", UUID.class, id)).isNull();
        cocreations.linkScript(owner, id, script, now.plusSeconds(8));
        assertThat(jdbc.queryForObject("SELECT script_id FROM script_cocreations WHERE id=?", UUID.class, id)).isEqualTo(script);
        assertThat(instant("SELECT updated_at FROM script_cocreations WHERE id=?", id)).isEqualTo(now.plusSeconds(8));
        assertThat(cocreations.restore(owner, id, 1, now)).as("확정했다").isFalse();

        UUID pending = UUID.randomUUID();
        cocreations.insertPending(pending, owner, UUID.randomUUID(), now);
        assertThat(cocreations.restore(owner, pending, 1, now)).as("아직 만드는 중").isFalse();
    }

    @Test
    @DisplayName("withSaveLock: 사람 행과 생성 행을 차례로 FOR UPDATE 로 잡고 그 줄을 넘긴다. 없는 줄·남의 줄이면 null 을 넘긴다. 안에서 한 쓰기는 같은 트랜잭션이다")
    void withSaveLockLocksTheUserThenTheRow() throws Exception {
        UUID request = UUID.randomUUID();
        UUID id = ready(owner, request);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            for (String[] step : new String[][] {{"users", owner.toString()}, {"script_cocreations", id.toString()}}) {
                run(probe, "SELECT 1 FROM " + step[0] + " WHERE id=? FOR KEY SHARE", UUID.fromString(step[1]));
                Future<UUID> blocked = pool.submit(() -> cocreations.withSaveLock(owner, id, Row::requestId));
                String waiting = awaitWaiting("from " + step[0]);
                probe.rollback();

                assertThat(waiting).as(step[0]).startsWith("select").contains("for update");
                assertThat(blocked.get(20, TimeUnit.SECONDS)).isEqualTo(request);
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(cocreations.<Boolean>withSaveLock(owner, UUID.randomUUID(), row -> row == null)).isTrue();
        assertThat(cocreations.<Boolean>withSaveLock(member(), id, row -> row == null)).isTrue();

        UUID script = script(owner);
        assertThatThrownBy(() -> cocreations.withSaveLock(owner, id, row -> {
            cocreations.linkScript(owner, id, script, now);
            throw new UnsupportedOperationException("저장이 실패했다");
        })).isInstanceOf(UnsupportedOperationException.class);
        assertThat(jdbc.queryForObject("SELECT script_id FROM script_cocreations WHERE id=?", UUID.class, id)).isNull();
        UUID linked = cocreations.withSaveLock(owner, id, row -> {
            cocreations.linkScript(owner, id, script, now);
            return cocreations.find(owner, id).scriptId();
        });
        assertThat(linked).as("같은 트랜잭션에서 다시 읽으면 방금 쓴 값이다").isEqualTo(script);
    }

    @Test
    @DisplayName("같은 요청 id 를 두 요청이 함께 넣으면 뒤의 것이 앞의 커밋을 기다렸다가 false 다. 앞의 것이 되돌리면 뒤의 것이 넣는다")
    void twoInsertsOfTheSameRequest() throws Exception {
        UUID request = UUID.randomUUID();
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            for (boolean commit : new boolean[] {false, true}) {
                CountDownLatch inserted = new CountDownLatch(1);
                CountDownLatch release = new CountDownLatch(1);
                Future<Boolean> first = pool.submit(() ->
                        new org.springframework.transaction.support.TransactionTemplate(transactionManager).execute(status -> {
                            boolean won = cocreations.insertPending(UUID.randomUUID(), owner, request, now);
                            inserted.countDown();
                            await(release);
                            if (!commit) {
                                status.setRollbackOnly();
                            }
                            return won;
                        }));
                await(inserted);
                Future<Boolean> second = pool.submit(() -> cocreations.insertPending(UUID.randomUUID(), owner, request, now));
                assertThat(awaitWaiting("script_cocreations")).startsWith("insert into script_cocreations");
                release.countDown();

                assertThat(first.get(20, TimeUnit.SECONDS)).isTrue();
                assertThat(second.get(20, TimeUnit.SECONDS)).as(commit ? "앞이 커밋" : "앞이 되돌림").isEqualTo(!commit);
                if (!commit) {
                    jdbc.update("DELETE FROM script_cocreations");
                }
            }
        } finally {
            pool.shutdownNow();
        }
        assertThat(count("script_cocreations")).isEqualTo(1);
    }

    @Test
    @DisplayName("같은 버전의 수정을 두 요청이 함께 시작하면 뒤의 것이 앞의 커밋을 기다렸다가 false 다 — 한 요청만 표시를 남긴다")
    void twoClaimsOfTheSameVersion() throws Exception {
        UUID id = ready(owner, UUID.randomUUID());
        CountDownLatch claimed = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Boolean> first = pool.submit(() -> inTransaction(() -> {
                boolean won = cocreations.claim(owner, id, 1, 3, now, now.minusSeconds(120));
                claimed.countDown();
                await(release);
                return won;
            }));
            await(claimed);
            Future<Boolean> second = pool.submit(() ->
                    cocreations.claim(owner, id, 1, 3, now.plusSeconds(1), now.minusSeconds(120)));
            assertThat(awaitWaiting("script_cocreations")).startsWith("update script_cocreations");
            release.countDown();

            assertThat(first.get(20, TimeUnit.SECONDS)).isTrue();
            assertThat(second.get(20, TimeUnit.SECONDS)).isFalse();
        } finally {
            pool.shutdownNow();
        }
        assertThat(instant("SELECT busy_since FROM script_cocreations WHERE id=?", id)).isEqualTo(now);
    }

    @Test
    @DisplayName("포트 메서드마다 나가는 문장: 읽기·쓰기 모두 한 문장이고, 잠그고 저장하기는 users 잠금과 생성 행 잠금 뒤에 일의 문장이다")
    void eachPortMethodSendsTheseStatements() {
        UUID id = UUID.randomUUID();
        UUID request = UUID.randomUUID();
        String select = "select script_cocreations";
        String update = "update script_cocreations";

        assertThat(statementsOf(() -> cocreations.insertPending(id, owner, request, now)))
                .containsExactly("insert script_cocreations on conflict");
        assertThat(statementsOf(() -> cocreations.complete(id, "{}", "[]", "m", now))).containsExactly(update);
        assertThat(statementsOf(() -> cocreations.find(owner, id))).containsExactly(select);
        assertThat(statementsOf(() -> cocreations.findByRequest(owner, request))).containsExactly(select);
        assertThat(statementsOf(() -> cocreations.countSince(owner, now))).containsExactly("count script_cocreations");
        assertThat(statementsOf(() -> cocreations.recentConditions(owner, 5))).containsExactly(select);
        assertThat(statementsOf(() -> cocreations.claim(owner, id, 1, 3, now, now.minusSeconds(60)))).containsExactly(update);
        assertThat(statementsOf(() -> cocreations.appendVersion(id, "[]", 2, now))).containsExactly(update);
        assertThat(statementsOf(() -> cocreations.restore(owner, id, 1, now))).containsExactly(update);
        assertThat(statementsOf(() -> cocreations.release(id))).containsExactly(update);
        assertThat(statementsOf(() -> cocreations.linkScript(owner, id, script(owner), now))).containsExactly(update);
        assertThat(statementsOf(() -> cocreations.withSaveLock(owner, id, row -> cocreations.find(owner, id))))
                .containsExactly("select users for update", "select script_cocreations for update", select);
        assertThat(statementsOf(() -> cocreations.deletePending(id))).containsExactly("delete script_cocreations");
    }

    /** 다 만든 줄: 조건 {@code {"조건":1}}, 버전 {@code ["첫 버전"]}, 지금 버전 1, 모델 gemini-test, 만든 시각 {@link #now}. */
    private UUID ready(UUID user, UUID request) {
        UUID id = UUID.randomUUID();
        cocreations.insertPending(id, user, request, now);
        cocreations.complete(id, "{\"조건\":1}", "[\"첫 버전\"]", "gemini-test", now);
        return id;
    }
}
