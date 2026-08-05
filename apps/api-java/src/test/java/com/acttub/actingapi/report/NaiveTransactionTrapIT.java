package com.acttub.actingapi.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

import java.util.UUID;

import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.annotation.Transactional;

/**
 * 순진한 이식이 <b>왜</b> 안 되는지를 실제로 재현한다.
 *
 * <p>Python 의 {@code except IntegrityError} 를 "메서드 하나에 {@code @Transactional} 붙이고
 * 그 안에서 try/catch" 로 옮기고 싶어지는 것이 자연스럽다. 하지만 Postgres 는 statement 하나가
 * 실패하면 <b>트랜잭션 전체를 abort</b> 시킨다. 그래서 예외를 삼킨 뒤의 코드는 두 가지로 갈린다.
 *
 * <ol>
 *   <li>DB 를 더 건드리면 {@code 25P02 current transaction is aborted} 로 터진다</li>
 *   <li>아무것도 안 하고 리턴하면 커밋이 <b>조용히 롤백으로 바뀐다</b> —
 *       예외도 없이 앞서 한 쓰기가 사라진다</li>
 * </ol>
 *
 * <p>2번이 특히 위험하다. 겉으로는 성공한 것처럼 보이기 때문이다.
 * 그래서 M0 은 예외를 <b>트랜잭션 경계 바깥</b>에서 잡는 구조를 채택했다
 * ({@link ReportOperationService}).
 */
@SpringBootTest
class NaiveTransactionTrapIT {

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String database = PostgresContainerSupport.createDatabaseName("naive_trap_it");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(database));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @TestConfiguration
    static class Config {
        @Bean
        NaivePort naivePort(JdbcTemplate jdbc) {
            return new NaivePort(jdbc);
        }
    }

    /** 안티패턴 재현용. 프로덕션 코드가 아니라서 테스트 소스에만 둔다. */
    static class NaivePort {

        private final JdbcTemplate jdbc;

        NaivePort(JdbcTemplate jdbc) {
            this.jdbc = jdbc;
        }

        /** 삼킨 뒤 아무것도 안 하고 리턴 → 커밋이 조용히 롤백된다. */
        @Transactional
        String swallowAndReturn(UUID markerUserId, UUID coachSessionId) {
            insertMarker(markerUserId);
            try {
                insertDuplicateReport(coachSessionId);
            } catch (DataIntegrityViolationException exc) {
                if (DuplicateReportDetector.isDuplicateReport(exc)) {
                    return "swallowed";
                }
                throw exc;
            }
            return "inserted";
        }

        /** 삼킨 뒤 DB 를 한 번 더 건드린다 → 25P02. */
        @Transactional
        String swallowThenQuery(UUID markerUserId, UUID coachSessionId) {
            insertMarker(markerUserId);
            try {
                insertDuplicateReport(coachSessionId);
            } catch (DataIntegrityViolationException exc) {
                if (!DuplicateReportDetector.isDuplicateReport(exc)) {
                    throw exc;
                }
            }
            jdbc.queryForObject("SELECT 1", Integer.class);
            return "unreachable";
        }

        private void insertMarker(UUID markerUserId) {
            jdbc.update("INSERT INTO users (id, email, status) "
                    + "VALUES (?, ?, 'active'::user_status_t)", markerUserId, markerUserId + "@m.test");
        }

        private void insertDuplicateReport(UUID coachSessionId) {
            jdbc.update("INSERT INTO reports "
                    + "(id, session_id, headline, biggest_problem, evidence, self_discovery, "
                    + "encouragement, next_step, comparison) "
                    + "VALUES (?, ?, 'dup', '{}'::jsonb, 'e', 's', 'en', 'n', '')",
                    UUID.randomUUID(), coachSessionId);
        }
    }

    @Autowired
    JdbcTemplate jdbc;
    @Autowired
    NaivePort naivePort;

    @Test
    @DisplayName("삼키고 리턴하면 예외 없이 성공한 척하지만 선행 쓰기가 사라진다")
    void swallowingInsideTransactionSilentlyLosesWrites() {
        ReportFixtures fixtures = new ReportFixtures(jdbc);
        UUID coachSession = fixtures.insertCoachSession(
                fixtures.insertSummary(fixtures.insertPracticeSession(fixtures.insertUser())));
        fixtures.insertReportDirectly(coachSession);

        UUID marker = UUID.randomUUID();
        String outcome = naivePort.swallowAndReturn(marker, coachSession);

        assertThat(outcome).isEqualTo("swallowed");
        assertThat(userExists(marker))
                .as("커밋했다고 생각했지만 Postgres 는 롤백했다 — 예외 하나 없이")
                .isFalse();
    }

    @Test
    @DisplayName("삼킨 뒤 DB 를 더 건드리면 25P02 로 터진다")
    void swallowingThenQueryingFails() {
        ReportFixtures fixtures = new ReportFixtures(jdbc);
        UUID coachSession = fixtures.insertCoachSession(
                fixtures.insertSummary(fixtures.insertPracticeSession(fixtures.insertUser())));
        fixtures.insertReportDirectly(coachSession);

        Throwable thrown = catchThrowable(
                () -> naivePort.swallowThenQuery(UUID.randomUUID(), coachSession));

        assertThat(thrown).isNotNull();
        assertThat(rootSqlState(thrown))
                .as("current transaction is aborted, commands ignored until end of transaction block")
                .isEqualTo("25P02");
    }

    private boolean userExists(UUID id) {
        Long count = jdbc.queryForObject("SELECT count(*) FROM users WHERE id = ?", Long.class, id);
        return count != null && count > 0;
    }

    private String rootSqlState(Throwable thrown) {
        for (Throwable current = thrown; current != null; current = current.getCause()) {
            if (current instanceof java.sql.SQLException sql && sql.getSQLState() != null) {
                return sql.getSQLState();
            }
            if (current.getCause() == current) {
                break;
            }
        }
        return null;
    }
}
