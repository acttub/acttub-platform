package com.acttub.actingapi.feature.reading;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.reading.app.ReadingOwnership;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 이관의 리딩 주인 바꾸기가 내는 결과·잠금·문장을 고정한다. 이관 전체(코드 입력에서 회원의 조회까지)는
 * {@code GuestTransferIT} 와 리딩 통합 테스트들이 본다. 여기서는 그 테스트가 밟지 않는 요청 id 가 겹칠 때, 다른 사람의 행,
 * 부르는 쪽 트랜잭션에 참여하는 것, 게스트 {@code users} 행의 잠금, 나가는 문장을 본다.
 */
class ReadingOwnershipIT extends ReadingRepositoryFixture {

    @Autowired
    ReadingOwnership ownership;

    /** 게스트의 대본·회차·녹음·암기 표시·회차 평가를 하나씩 만든다. */
    private record Material(UUID script, UUID session, UUID recording, UUID memorization, UUID rating) {
    }

    private Material material(UUID owner, UUID scriptRequestId, UUID sessionRequestId) {
        UUID script = script(owner, scriptRequestId);
        UUID nina = character(script, "니나", 0);
        UUID line = line(script, 1, "dialogue", nina, "안녕");
        UUID session = sessionWithRequest(owner, script, sessionRequestId, line, line, nina);
        UUID recording = recording(owner, session, line, 1, "reading/" + UUID.randomUUID() + ".m4a");
        UUID memorization = UUID.randomUUID();
        jdbc.update("INSERT INTO line_memorization(id,user_id,line_id,status) VALUES (?,?,?,'memorized')",
                memorization, owner, line);
        UUID rating = UUID.randomUUID();
        jdbc.update("INSERT INTO reading_session_ratings(id,session_id,user_id,rating,request_id) VALUES (?,?,?,'good',?)",
                rating, session, owner, UUID.randomUUID());
        return new Material(script, session, recording, memorization, rating);
    }

    @Test
    @DisplayName("reassign: 게스트의 대본·회차·녹음·암기 표시·회차 평가의 주인만 회원으로 바꾼다. 다른 사람의 행과 겹치지 않는 요청 id 는 그대로다")
    void reassignMovesTheFiveTables() {
        UUID guest = member();
        UUID member = member();
        UUID stranger = member();
        UUID scriptRequest = UUID.randomUUID();
        UUID sessionRequest = UUID.randomUUID();
        Material moved = material(guest, scriptRequest, sessionRequest);
        Material untouched = material(stranger, UUID.randomUUID(), UUID.randomUUID());

        inTransaction(() -> {
            ownership.reassign(guest, member);
            return null;
        });

        assertThat(ownerOf("scripts", moved.script())).isEqualTo(member);
        assertThat(ownerOf("reading_sessions", moved.session())).isEqualTo(member);
        assertThat(ownerOf("reading_recordings", moved.recording())).isEqualTo(member);
        assertThat(ownerOf("line_memorization", moved.memorization())).isEqualTo(member);
        assertThat(ownerOf("reading_session_ratings", moved.rating())).isEqualTo(member);
        assertThat(jdbc.queryForObject("SELECT request_id FROM scripts WHERE id=?", UUID.class, moved.script()))
                .isEqualTo(scriptRequest);
        assertThat(jdbc.queryForObject("SELECT request_id FROM reading_sessions WHERE id=?", UUID.class, moved.session()))
                .isEqualTo(sessionRequest);
        assertThat(ownerOf("scripts", untouched.script())).isEqualTo(stranger);
        assertThat(ownerOf("reading_sessions", untouched.session())).isEqualTo(stranger);
        assertThat(ownerOf("reading_recordings", untouched.recording())).isEqualTo(stranger);
        assertThat(ownerOf("line_memorization", untouched.memorization())).isEqualTo(stranger);
        assertThat(ownerOf("reading_session_ratings", untouched.rating())).isEqualTo(stranger);
    }

    @Test
    @DisplayName("reassign: 게스트와 회원의 요청 id 가 겹치면 게스트 쪽 대본·회차의 요청 id 를 비우고 옮긴다. 회원 쪽과 겹치지 않는 게스트 행은 그대로다")
    void reassignClearsAClashingRequestId() {
        UUID guest = member();
        UUID member = member();
        UUID scriptRequest = UUID.randomUUID();
        UUID sessionRequest = UUID.randomUUID();
        Material clashing = material(guest, scriptRequest, sessionRequest);
        Material free = material(guest, UUID.randomUUID(), UUID.randomUUID());
        Material members = material(member, scriptRequest, sessionRequest);

        inTransaction(() -> {
            ownership.reassign(guest, member);
            return null;
        });

        assertThat(jdbc.queryForObject("SELECT request_id FROM scripts WHERE id=?", UUID.class, clashing.script())).isNull();
        assertThat(jdbc.queryForObject("SELECT request_id FROM reading_sessions WHERE id=?", UUID.class, clashing.session()))
                .isNull();
        assertThat(jdbc.queryForObject("SELECT request_id FROM scripts WHERE id=?", UUID.class, free.script())).isNotNull();
        assertThat(jdbc.queryForObject("SELECT request_id FROM reading_sessions WHERE id=?", UUID.class, free.session()))
                .isNotNull();
        assertThat(jdbc.queryForObject("SELECT request_id FROM scripts WHERE id=?", UUID.class, members.script()))
                .isEqualTo(scriptRequest);
        assertThat(jdbc.queryForObject("SELECT request_id FROM reading_sessions WHERE id=?", UUID.class, members.session()))
                .isEqualTo(sessionRequest);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM scripts WHERE user_id=?", Integer.class, member)).isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM reading_sessions WHERE user_id=?", Integer.class, member)).isEqualTo(3);
    }

    @Test
    @DisplayName("reassign 은 부르는 쪽 트랜잭션에 참여한다 — 그 트랜잭션을 되돌리면 아무것도 옮겨지지 않는다")
    void reassignJoinsTheCallersTransaction() {
        UUID guest = member();
        UUID member = member();
        Material material = material(guest, UUID.randomUUID(), UUID.randomUUID());

        new org.springframework.transaction.support.TransactionTemplate(transactionManager).executeWithoutResult(status -> {
            ownership.reassign(guest, member);
            assertThat(ownerOf("scripts", material.script())).as("같은 트랜잭션에서는 옮겨진 것이 보인다").isEqualTo(member);
            status.setRollbackOnly();
        });

        assertThat(ownerOf("scripts", material.script())).isEqualTo(guest);
        assertThat(ownerOf("reading_session_ratings", material.rating())).isEqualTo(guest);
    }

    @Test
    @DisplayName("reassign 은 게스트의 users 행을 FOR UPDATE 로 먼저 잡는다 — 바깥 연결이 그 행을 FOR KEY SHARE 로 잡고 있으면 그 뒤에서 기다린다")
    void reassignLocksTheGuestRowFirst() throws Exception {
        UUID guest = member();
        UUID member = member();
        Material material = material(guest, UUID.randomUUID(), UUID.randomUUID());
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = probe()) {
            run(probe, "SELECT 1 FROM users WHERE id=? FOR KEY SHARE", guest);
            Future<Object> blocked = pool.submit(() -> inTransaction(() -> {
                ownership.reassign(guest, member);
                return null;
            }));
            String waiting = awaitWaiting("from users");
            assertThat(ownerOf("scripts", material.script())).as("잠금을 기다리는 동안 아무것도 옮기지 않았다").isEqualTo(guest);
            probe.rollback();

            assertThat(waiting).startsWith("select").contains("for update");
            blocked.get(20, TimeUnit.SECONDS);
        } finally {
            pool.shutdownNow();
        }
        assertThat(ownerOf("scripts", material.script())).isEqualTo(member);
    }

    @Test
    @DisplayName("reassign 이 보내는 문장: users 잠금, 요청 id 비우기 둘(대본·회차), 주인 바꾸기 다섯")
    void reassignSendsTheseStatements() {
        UUID guest = member();
        UUID member = member();
        material(guest, UUID.randomUUID(), UUID.randomUUID());

        assertThat(statementsOf(() -> inTransaction(() -> {
            ownership.reassign(guest, member);
            return null;
        }))).containsExactly(
                "select users for update",
                "update scripts", "update reading_sessions",
                "update scripts", "update reading_sessions", "update reading_recordings", "update line_memorization",
                "update reading_session_ratings");
    }
}
