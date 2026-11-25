package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.time.temporal.ChronoUnit;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.reading.app.MemorizationRepository;
import com.acttub.actingapi.feature.reading.app.MemorizationRepository.Change;
import com.acttub.actingapi.feature.reading.app.MemorizationRepository.MemorizationView;
import com.acttub.actingapi.feature.reading.app.MemorizationRepository.Outcome;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 암기 표시 저장소가 내는 결과·잠금·경합·문장을 고정한다. HTTP 쪽 검증과 대본·회차 삭제, 이관은
 * {@link ReadingMemorizationIT} 가 본다. 여기서는 그 테스트가 밟지 않는 시각의 정밀도, 대본 행만 잡는 잠금, 잠금을 기다린
 * 뒤 다시 보는 주인, 두 요청이 같은 줄을 다툴 때의 결과, 포트 메서드마다 나가는 문장을 본다.
 *
 * <p>저장소를 네이티브 SQL 에서 JPA 로 옮길 때 문장 테스트 한 곳만 달라졌다 — upsert 의 {@code RETURNING} 을 같은
 * 트랜잭션의 다시 읽기로 나눠 표시할 때 문장이 하나 늘었다. 결과·잠금·경합 테스트는 고치지 않았다.
 */
class MemorizationRepositoryIT extends ReadingRepositoryFixture {

    @Autowired
    MemorizationRepository memorization;

    private UUID owner;
    private UUID script;
    private UUID dialogue;
    private UUID direction;

    @BeforeEach
    void setUp() {
        owner = member();
        script = script(owner);
        UUID nina = character(script, "니나", 0);
        direction = line(script, 1, "direction", null, "무대가 밝아진다");
        dialogue = line(script, 2, "dialogue", nina, "안녕");
    }

    @Test
    @DisplayName("set: 처음이면 행을 만들고 시각을 마이크로초로 자른다. 같은 상태를 다시 보내면 updated_at 을 그대로 두고, 다른 상태면 그 시각으로 바꾼다. id 와 created_at 은 처음 것이다")
    void setCreatesThenKeepsOrMovesTheTimestamp() {
        Change created = memorization.set(owner, dialogue, "memorized", now.plusNanos(123_456_789));
        assertThat(created).isEqualTo(new Change(Outcome.SAVED,
                new MemorizationView(dialogue, "memorized", now.plus(123_456, ChronoUnit.MICROS))));
        UUID rowId = jdbc.queryForObject("SELECT id FROM line_memorization", UUID.class);

        Change same = memorization.set(owner, dialogue, "memorized", now.plusSeconds(60));
        assertThat(same).isEqualTo(new Change(Outcome.UNCHANGED,
                new MemorizationView(dialogue, "memorized", now.plus(123_456, ChronoUnit.MICROS))));

        Change changed = memorization.set(owner, dialogue, "not_yet", now.plusSeconds(120));
        assertThat(changed).isEqualTo(new Change(Outcome.SAVED,
                new MemorizationView(dialogue, "not_yet", now.plusSeconds(120))));

        assertThat(jdbc.queryForMap("SELECT id,user_id,line_id,status FROM line_memorization"))
                .containsEntry("id", rowId).containsEntry("user_id", owner).containsEntry("line_id", dialogue)
                .containsEntry("status", "not_yet");
        assertThat(instant("SELECT created_at FROM line_memorization")).isEqualTo(now.plus(123_456, ChronoUnit.MICROS));
        assertThat(instant("SELECT updated_at FROM line_memorization")).isEqualTo(now.plusSeconds(120));
    }

    @Test
    @DisplayName("set: 대사 줄이 아니면 INVALID_LINE 이고, 없는 줄·남의 대본의 줄은 null 이다. 어느 쪽도 행을 만들지 않는다")
    void setRefusesOtherKindsAndOtherOwners() {
        UUID stranger = member();

        assertThat(memorization.set(owner, direction, "memorized", now)).isEqualTo(new Change(Outcome.INVALID_LINE, null));
        assertThat(memorization.set(owner, UUID.randomUUID(), "memorized", now)).isNull();
        assertThat(memorization.set(stranger, dialogue, "memorized", now)).isNull();

        assertThat(count("line_memorization")).isZero();
    }

    @Test
    @DisplayName("list: 그 대본의 내 표시만 줄 순서로 낸다. 표시가 없으면 빈 목록, 없는 대본·남의 대본은 null 이다")
    void listReturnsMyMarksInLineOrder() {
        UUID nina = jdbc.queryForObject("SELECT id FROM script_characters", UUID.class);
        UUID later = line(script, 3, "dialogue", nina, "잘 가");
        UUID stranger = member();
        UUID otherScript = script(owner);
        UUID otherLine = line(otherScript, 1, "dialogue", character(otherScript, "코스챠", 0), "다른 대본");
        memorization.set(owner, later, "not_yet", now);
        memorization.set(owner, dialogue, "memorized", now.plusSeconds(1));
        memorization.set(owner, otherLine, "memorized", now);

        assertThat(memorization.list(owner, script)).containsExactly(
                new MemorizationView(dialogue, "memorized", now.plusSeconds(1)),
                new MemorizationView(later, "not_yet", now));
        assertThat(memorization.list(owner, script(owner))).isEmpty();
        assertThat(memorization.list(stranger, script)).isNull();
        assertThat(memorization.list(owner, UUID.randomUUID())).isNull();
    }

    @Test
    @DisplayName("set 의 잠금은 대본 행의 FOR UPDATE 다 — 바깥 연결이 대본 행을 FOR KEY SHARE 로 잡고 있으면 그 뒤에서 기다린다. 줄 행은 잠그지 않는다")
    void setLocksTheScriptRowOnly() throws Exception {
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            run(probe, "SELECT 1 FROM script_lines WHERE id=? FOR NO KEY UPDATE", dialogue);
            assertThat(pool.submit(() -> memorization.set(owner, dialogue, "memorized", now)).get(20, TimeUnit.SECONDS).outcome())
                    .as("줄 행을 FOR UPDATE 로 잡는다면 여기서 기다렸을 것이다").isEqualTo(Outcome.SAVED);
            probe.rollback();

            run(probe, "SELECT 1 FROM scripts WHERE id=? FOR KEY SHARE", script);
            Future<Change> blocked = pool.submit(() -> memorization.set(owner, dialogue, "not_yet", now.plusSeconds(1)));
            String waiting = awaitWaiting("scripts");
            probe.rollback();

            assertThat(waiting).startsWith("select").contains("for update");
            assertThat(blocked.get(20, TimeUnit.SECONDS).outcome()).isEqualTo(Outcome.SAVED);
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("대본을 옮기는 사이에 온 표시는 대본 행에서 기다렸다가 다시 본다 — 커밋되면 남의 것이라 null 이고 아무것도 남지 않는다. 되돌리면 저장한다")
    void setRechecksTheOwnerAfterWaiting() throws Exception {
        UUID member = member();
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            run(probe, "UPDATE scripts SET user_id=? WHERE id=?", member, script);
            Future<Change> rolledBack = pool.submit(() -> memorization.set(owner, dialogue, "memorized", now));
            awaitWaiting("scripts");
            probe.rollback();
            assertThat(rolledBack.get(20, TimeUnit.SECONDS).outcome()).isEqualTo(Outcome.SAVED);

            run(probe, "UPDATE scripts SET user_id=? WHERE id=?", member, script);
            Future<Change> committed = pool.submit(() -> memorization.set(owner, dialogue, "not_yet", now.plusSeconds(1)));
            awaitWaiting("scripts");
            probe.commit();
            assertThat(committed.get(20, TimeUnit.SECONDS)).isNull();
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT status FROM line_memorization", String.class)).isEqualTo("memorized");
    }

    @Test
    @DisplayName("두 기기가 같은 줄을 함께 표시하면 뒤의 것이 대본 행에서 앞의 커밋을 기다렸다가 자기 값을 쓴다. 행은 하나다")
    void twoDevicesMarkingTheSameLine() throws Exception {
        java.util.concurrent.CountDownLatch firstWrote = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch release = new java.util.concurrent.CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Change> first = pool.submit(() -> inTransaction(() -> {
                Change change = memorization.set(owner, dialogue, "memorized", now);
                firstWrote.countDown();
                await(release);
                return change;
            }));
            await(firstWrote);
            Future<Change> second = pool.submit(() -> memorization.set(owner, dialogue, "not_yet", now.plusSeconds(5)));
            awaitWaiting("scripts");
            release.countDown();

            assertThat(first.get(20, TimeUnit.SECONDS).view().status()).isEqualTo("memorized");
            assertThat(second.get(20, TimeUnit.SECONDS)).isEqualTo(new Change(Outcome.SAVED,
                    new MemorizationView(dialogue, "not_yet", now.plusSeconds(5))));
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT status FROM line_memorization", String.class)).containsExactly("not_yet");
    }

    @Test
    @DisplayName("포트 메서드마다 나가는 문장: set 은 대본 행을 잠그는 조회 하나와 upsert, 쓴 행 다시 읽기다. 줄이 없거나 대사가 아니면 조회 하나다. list 는 대본 확인과 목록, 남의 대본이면 확인 하나다")
    void eachPortMethodSendsTheseStatements() {
        assertThat(statementsOf(() -> memorization.set(owner, dialogue, "memorized", now)))
                .containsExactly("select scripts for update", "insert line_memorization on conflict",
                        "select line_memorization");
        assertThat(statementsOf(() -> memorization.set(owner, direction, "memorized", now)))
                .containsExactly("select scripts for update");
        assertThat(statementsOf(() -> memorization.set(owner, UUID.randomUUID(), "memorized", now)))
                .containsExactly("select scripts for update");
        assertThat(statementsOf(() -> memorization.list(owner, script)))
                .containsExactly("select scripts", "select line_memorization");
        assertThat(statementsOf(() -> memorization.list(owner, UUID.randomUUID()))).containsExactly("select scripts");
    }
}
