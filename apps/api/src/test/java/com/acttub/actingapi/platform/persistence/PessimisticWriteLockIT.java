package com.acttub.actingapi.platform.persistence;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.challenge.app.ChallengeRepository;
import com.acttub.actingapi.support.PostgresContainerSupport;
import jakarta.persistence.EntityManagerFactory;
import org.hibernate.dialect.Dialect;
import org.hibernate.engine.spi.SessionFactoryImplementor;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * JPA 로 거는 쓰기 잠금(PESSIMISTIC_WRITE)이 네이티브 SQL 과 같은 {@code FOR UPDATE} 로 나가는지 실제 PostgreSQL 에서 본다
 * ({@link ForUpdatePostgreSQLDialect}, apps/api/CONTRACT.md §5-2).
 *
 * <p>잠금 문장은 JPA 로 잠그는 운영 코드(챌린지 지우기)가 보낸 것을 DB 가 받은 글자 그대로 잡는다. 바깥 연결이 FK 검사와 같은
 * {@code FOR KEY SHARE} 를 먼저 잡아 두면, {@code FOR UPDATE} 는 그 뒤에서 기다리고 Hibernate 기본값인
 * {@code FOR NO KEY UPDATE} 는 기다리지 않는다. 기다리는 동안 {@code pg_stat_activity} 에 그 문장이 남는다.
 */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
class PessimisticWriteLockIT {

    @Value("${spring.datasource.url}")
    private String databaseUrl;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    ChallengeRepository challenges;

    @Autowired
    EntityManagerFactory entityManagerFactory;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users,challenges RESTART IDENTITY CASCADE");
    }

    @Test
    @DisplayName("JPA 의 쓰기 잠금은 FOR UPDATE 로 나간다 — 자식 행의 FK 검사(FOR KEY SHARE)를 잡은 쪽이 끝날 때까지 기다린다")
    void pessimisticWriteGoesOutAsForUpdate() throws Exception {
        UUID host = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", host);
        UUID challenge = UUID.randomUUID();
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        jdbc.update("""
                INSERT INTO challenges (id,line,work,duration_days,origin,host_user_id,request_id,request_fingerprint,
                                        starts_at,ends_at)
                VALUES (?, '대사', '작품', 7, 'member', ?, ?, ?, ?, ?)
                """, challenge, host, UUID.randomUUID(), "a".repeat(64), now.minusHours(1), now.plusDays(7));
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection child = outsideConnection()) {
            child.setAutoCommit(false);
            try (PreparedStatement statement = child.prepareStatement(
                    "SELECT 1 FROM challenges WHERE id=? FOR KEY SHARE")) {
                statement.setObject(1, challenge);
                statement.execute();
            }

            Future<Boolean> deleting = pool.submit(() -> challenges.delete(host, challenge, Instant.now()));
            String waiting = awaitStatementWaitingOnChallenges();
            child.rollback();

            assertThat(waiting).matches("select .+ from challenges (\\w+) where \\1\\.id=\\$1 for update of \\1");
            assertThat(deleting.get(20, TimeUnit.SECONDS)).isTrue();
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("방언은 연결에서 읽은 DB 버전으로 만든다 — 방언을 지정하지 않았을 때와 같다")
    void dialectKeepsTheServerVersion() {
        Dialect dialect = entityManagerFactory.unwrap(SessionFactoryImplementor.class).getJdbcServices().getDialect();
        int server = jdbc.queryForObject("SELECT current_setting('server_version_num')::int", Integer.class);

        assertThat(dialect).isInstanceOf(ForUpdatePostgreSQLDialect.class);
        assertThat(List.of(dialect.getVersion().getMajor(), dialect.getVersion().getMinor()))
                .isEqualTo(List.of(server / 10000, server % 10000));
    }

    private String awaitStatementWaitingOnChallenges() throws Exception {
        Instant deadline = Instant.now().plusSeconds(10);
        while (Instant.now().isBefore(deadline)) {
            List<String> waiting = jdbc.queryForList("""
                    SELECT query FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event_type='Lock'
                      AND query LIKE '%from challenges%'
                    """, String.class);
            if (!waiting.isEmpty()) {
                return waiting.getFirst();
            }
            Thread.sleep(10);
        }
        throw new AssertionError("JPA 잠금이 FOR KEY SHARE 뒤에서 기다리지 않았다 — FOR UPDATE 가 아니다");
    }

    private Connection outsideConnection() throws Exception {
        return DriverManager.getConnection(databaseUrl,
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword());
    }
}
