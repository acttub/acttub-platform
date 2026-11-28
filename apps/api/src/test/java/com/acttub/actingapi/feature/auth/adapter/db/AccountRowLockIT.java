package com.acttub.actingapi.feature.auth.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

import javax.sql.DataSource;

import com.acttub.actingapi.feature.auth.app.AccountFacts;
import com.acttub.actingapi.feature.auth.app.AccountRowLock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 다른 기능이 자기 쓰기 앞에 거는 계정 행 잠금({@link AccountRowLock})을 실제 PostgreSQL 에서 본다. 잠금을 쓰는 흐름마다의
 * 문장 순서와 겹친 쓰기의 결과는 각 기능의 저장소 테스트가 본다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
class AccountRowLockIT {

    @Autowired
    AccountRowLock accountRows;

    @Autowired
    AccountFacts accountFacts;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    TransactionTemplate transaction;

    @Autowired
    DataSource dataSource;

    private UUID active;
    private UUID closed;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        active = UUID.randomUUID();
        closed = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", active);
        jdbc.update("INSERT INTO users(id,status,deactivated_at) VALUES (?,'deactivated',now())", closed);
    }

    @Test
    @DisplayName("활성 계정이면 참, 탈퇴한 계정과 없는 계정이면 거짓이다")
    void tellsWhetherTheAccountIsActive() {
        assertThat(lockActive(active)).isTrue();
        assertThat(lockActive(closed)).isFalse();
        assertThat(lockActive(UUID.randomUUID())).isFalse();
    }

    @Test
    @DisplayName("트랜잭션이 끝날 때까지 그 행을 쥔다: 활성 계정도 탈퇴한 계정도, 잠그기만 할 때도 다른 연결은 그 행을 잡지 못한다")
    void holdsTheRowUntilTheTransactionEnds() {
        transaction.executeWithoutResult(tx -> {
            accountRows.lockActive(active);
            accountRows.lockRow(closed);
            assertThat(anotherConnectionCanLock(active)).isFalse();
            assertThat(anotherConnectionCanLock(closed)).isFalse();
        });
        assertThat(anotherConnectionCanLock(active)).as("트랜잭션이 끝나면 풀린다").isTrue();
        assertThat(anotherConnectionCanLock(closed)).isTrue();
    }

    @Test
    @DisplayName("잠그지 않고 활성인지만 물을 수 있다: 탈퇴한 계정과 없는 계정은 거짓이고, 트랜잭션 밖에서도 답한다")
    void tellsWhetherTheAccountIsActiveWithoutLocking() {
        assertThat(accountFacts.active(active)).isTrue();
        assertThat(accountFacts.active(closed)).isFalse();
        assertThat(accountFacts.active(UUID.randomUUID())).isFalse();
        transaction.executeWithoutResult(tx -> {
            accountFacts.active(active);
            assertThat(anotherConnectionCanLock(active)).as("잠그지 않는다").isTrue();
        });
    }

    @Test
    @DisplayName("잠그기만 할 때와 읽기로 잠글 때는 계정이 있는지를 답한다 — 탈퇴한 계정도 있는 계정이다")
    void tellsWhetherTheAccountExists() {
        assertThat(lockRow(active)).isTrue();
        assertThat(lockRow(closed)).isTrue();
        assertThat(lockRow(UUID.randomUUID())).isFalse();
        assertThat(lockShared(active)).isTrue();
        assertThat(lockShared(closed)).isTrue();
        assertThat(lockShared(UUID.randomUUID())).isFalse();
    }

    @Test
    @DisplayName("읽기 잠금은 FOR SHARE 다: 다른 연결의 읽기 잠금과 함께 쥐고, 쓰기 잠금은 트랜잭션이 끝날 때까지 막는다")
    void theSharedLockLetsReadersInAndKeepsWritersOut() {
        transaction.executeWithoutResult(tx -> {
            accountRows.lockShared(active);
            assertThat(anotherConnectionCanLock(active, "FOR SHARE")).isTrue();
            assertThat(anotherConnectionCanLock(active, "FOR UPDATE")).isFalse();
        });
        assertThat(anotherConnectionCanLock(active)).as("트랜잭션이 끝나면 풀린다").isTrue();
    }

    @Test
    @DisplayName("트랜잭션 밖에서 부르면 거절한다 — 잠금이 바로 풀려 줄을 세우지 못한다")
    void refusesToLockOutsideATransaction() {
        assertThatThrownBy(() -> accountRows.lockActive(active)).isInstanceOf(RuntimeException.class);
        assertThatThrownBy(() -> accountRows.lockRow(active)).isInstanceOf(RuntimeException.class);
        assertThatThrownBy(() -> accountRows.lockShared(active)).isInstanceOf(RuntimeException.class);
    }

    private boolean lockActive(UUID userId) {
        return transaction.execute(tx -> accountRows.lockActive(userId));
    }

    private boolean lockRow(UUID userId) {
        return transaction.execute(tx -> accountRows.lockRow(userId));
    }

    private boolean lockShared(UUID userId) {
        return transaction.execute(tx -> accountRows.lockShared(userId));
    }

    private boolean anotherConnectionCanLock(UUID userId) {
        return anotherConnectionCanLock(userId, "FOR UPDATE");
    }

    /** 다른 연결에서 기다리지 않고 그 행을 그 세기로 잡아 본다. */
    private boolean anotherConnectionCanLock(UUID userId, String strength) {
        try (Connection other = dataSource.getConnection()) {
            other.setAutoCommit(false);
            try (Statement statement = other.createStatement()) {
                statement.executeQuery("SELECT id FROM users WHERE id='" + userId + "' " + strength + " NOWAIT").close();
                return true;
            } catch (SQLException locked) {
                assertThat(locked.getSQLState()).as("잠겨서 못 잡은 것이어야 한다").isEqualTo("55P03");
                return false;
            } finally {
                other.rollback();
            }
        } catch (SQLException failure) {
            throw new IllegalStateException(failure);
        }
    }
}
