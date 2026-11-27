package com.acttub.actingapi.feature.auth.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.UUID;

import javax.sql.DataSource;

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
    @DisplayName("트랜잭션 밖에서 부르면 거절한다 — 잠금이 바로 풀려 줄을 세우지 못한다")
    void refusesToLockOutsideATransaction() {
        assertThatThrownBy(() -> accountRows.lockActive(active)).isInstanceOf(RuntimeException.class);
        assertThatThrownBy(() -> accountRows.lockRow(active)).isInstanceOf(RuntimeException.class);
    }

    private boolean lockActive(UUID userId) {
        return transaction.execute(tx -> accountRows.lockActive(userId));
    }

    /** 다른 연결에서 기다리지 않고 그 행을 잡아 본다. */
    private boolean anotherConnectionCanLock(UUID userId) {
        try (Connection other = dataSource.getConnection()) {
            other.setAutoCommit(false);
            try (Statement statement = other.createStatement()) {
                statement.executeQuery("SELECT id FROM users WHERE id='" + userId + "' FOR UPDATE NOWAIT").close();
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
