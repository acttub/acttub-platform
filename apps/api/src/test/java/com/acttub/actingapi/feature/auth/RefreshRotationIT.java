package com.acttub.actingapi.feature.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import javax.sql.DataSource;

import com.acttub.actingapi.feature.auth.app.AuthRepository;
import com.acttub.actingapi.feature.auth.app.JwtService;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest(properties = {
    "JWT_SECRET=회전-비ASCII-secret",
    "spring.datasource.hikari.connection-init-sql=SET lock_timeout='3s'",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.auth.RefreshRotationIT$RecordingInspector"
})
@AutoConfigureMockMvc
class RefreshRotationIT {
    public static class RecordingInspector implements StatementInspector {
        private static final List<String> STATEMENTS =
                Collections.synchronizedList(new ArrayList<>());

        @Override
        public String inspect(String sql) {
            STATEMENTS.add(sql);
            return sql;
        }

        static void clear() {
            STATEMENTS.clear();
        }

        static List<String> refreshStatements() {
            synchronized (STATEMENTS) {
                return STATEMENTS.stream()
                        .map(sql -> sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT))
                        .filter(sql -> sql.contains("refresh_tokens"))
                        .toList();
            }
        }
    }

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("refresh_rotation");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    JwtService jwt;

    @Autowired
    AuthRepository store;

    @Autowired
    MockMvc mvc;

    @Autowired
    DataSource dataSource;

    @Test
    void normalRotationAndReuseKeepTheLockedSqlOrderAndRoundTripBudget() {
        UUID user = insertUser();
        String oldHash = "1".repeat(64);
        String replacementHash = "2".repeat(64);
        Instant now = Instant.parse("2026-09-01T08:00:00Z");
        store.issueRefresh(user, oldHash, now.plusSeconds(3600), "old-device", now);

        RecordingInspector.clear();
        AuthRepository.Rotation rotated = store.rotate(
                oldHash,
                replacementHash,
                now.plusSeconds(7200),
                null,
                now.plusSeconds(1));

        assertThat(rotated.id()).isNotNull();
        assertThat(rotated.reused()).isFalse();
        List<String> normal = RecordingInspector.refreshStatements();
        assertThat(normal).hasSize(3);
        assertThat(normal.get(0)).startsWith("select * from refresh_tokens").endsWith("for update");
        assertThat(normal.get(1)).startsWith("insert into refresh_tokens");
        assertThat(normal.get(2)).startsWith("update refresh_tokens");

        RecordingInspector.clear();
        AuthRepository.Rotation reused = store.rotate(
                oldHash,
                "3".repeat(64),
                now.plusSeconds(7200),
                null,
                now.plusSeconds(2));

        assertThat(reused.id()).isNull();
        assertThat(reused.reused()).isTrue();
        List<String> reuse = RecordingInspector.refreshStatements();
        assertThat(reuse).hasSize(2);
        assertThat(reuse.get(0)).startsWith("select * from refresh_tokens").endsWith("for update");
        assertThat(reuse.get(1)).startsWith("update refresh_tokens");
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM refresh_tokens WHERE user_id=? AND revoked_at IS NULL",
                Integer.class,
                user)).isZero();
    }

    @Test
    void simultaneousReuseReturnsOneSuccessOneUnauthorizedAndRevokesAll() throws Exception {
        UUID user = insertUser();
        var old = jwt.issueRefreshToken(user);
        store.issueRefresh(
                user,
                JwtService.hashToken(old.value()),
                old.expiresAt(),
                null,
                Instant.now());
        String json = "{\"refresh_token\":\"" + old.value() + "\"}";
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            CountDownLatch start = new CountDownLatch(1);
            Callable<Integer> call = () -> {
                start.await();
                return mvc.perform(post("/v2/auth/refresh")
                                .contentType("application/json")
                                .content(json))
                        .andReturn()
                        .getResponse()
                        .getStatus();
            };
            Future<Integer> first = pool.submit(call);
            Future<Integer> second = pool.submit(call);
            start.countDown();
            assertThat(List.of(first.get(), second.get())).containsExactlyInAnyOrder(200, 401);
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM refresh_tokens WHERE user_id=? AND revoked_at IS NULL",
                Integer.class,
                user)).isZero();
        assertThat(jdbc.queryForObject(
                "SELECT bool_and(token_hash ~ '^[0-9a-f]{64}$') "
                        + "FROM refresh_tokens WHERE user_id=?",
                Boolean.class,
                user)).isTrue();
    }

    @Test
    void rotationActuallyWaitsForTheRefreshTokenRowLock() throws Exception {
        UUID user = insertUser();
        String oldHash = "4".repeat(64);
        Instant now = Instant.parse("2026-09-01T09:00:00Z");
        store.issueRefresh(user, oldHash, now.plusSeconds(3600), null, now);
        ExecutorService pool = Executors.newSingleThreadExecutor();

        try (Connection blocker = dataSource.getConnection()) {
            blocker.setAutoCommit(false);
            try (PreparedStatement lock = blocker.prepareStatement("""
                    SELECT id
                    FROM refresh_tokens
                    WHERE token_hash=?
                    FOR UPDATE
                    """)) {
                lock.setString(1, oldHash);
                lock.executeQuery().close();
            }

            Future<AuthRepository.Rotation> waiting = pool.submit(() -> store.rotate(
                    oldHash,
                    "5".repeat(64),
                    now.plusSeconds(7200),
                    null,
                    now.plusSeconds(1)));
            try {
                assertThat(awaitRefreshLockWait()).isTrue();
            } finally {
                blocker.rollback();
            }

            assertThat(waiting.get(5, TimeUnit.SECONDS).id()).isNotNull();
        } finally {
            pool.shutdownNow();
        }
    }

    private UUID insertUser() {
        UUID user = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active')", user);
        return user;
    }

    private boolean awaitRefreshLockWait() throws InterruptedException {
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
        do {
            Integer waiting = jdbc.queryForObject("""
                    SELECT count(*)
                    FROM pg_stat_activity
                    WHERE datname=current_database()
                      AND wait_event_type='Lock'
                      AND query ILIKE '%refresh_tokens%'
                      AND query ILIKE '%FOR UPDATE%'
                    """, Integer.class);
            if (waiting != null && waiting > 0) {
                return true;
            }
            Thread.sleep(10);
        } while (System.nanoTime() < deadline);
        return false;
    }
}
