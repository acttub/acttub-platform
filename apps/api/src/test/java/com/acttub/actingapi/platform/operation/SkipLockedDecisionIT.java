package com.acttub.actingapi.platform.operation;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import java.time.OffsetDateTime;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.support.PostgresContainerSupport;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;

class SkipLockedDecisionIT {

    @Test
    void secondWorkerWaitsThenReturnsNoneInsteadOfTakingSecondJob() throws Exception {
        String url = PostgresContainerSupport.createDatabase("skip_locked_decision");
        Flyway.configure().dataSource(url, PostgresContainerSupport.POSTGRES.getUsername(),
                PostgresContainerSupport.POSTGRES.getPassword()).load().migrate();

        try (Connection setup = connect(url)) {
            UUID user = UUID.randomUUID();
            UUID upload = UUID.randomUUID();
            UUID session = UUID.randomUUID();
            execute(setup, "INSERT INTO users(id,status) VALUES (?,'active')", user);
            execute(setup, """
                    INSERT INTO upload_intents(id,user_id,status,storage_provider,object_key,mime_type,size_bytes,expires_at)
                    VALUES (?,?,'pending','s3','k','video/mp4',1,now())
                    """, upload, user);
            execute(setup, """
                    INSERT INTO practice_sessions(id,user_id,upload_intent_id,status,situation,character_context,blockage_kind,sub_branch,goal)
                    VALUES (?,?,?,'analyzing','s','c','분석','캐릭터 분석','g')
                    """, session, user, upload);
            for (int index = 0; index < 2; index++) {
                execute(setup, """
                        INSERT INTO external_operations(id,session_id,user_id,request_id,kind,status,request_fingerprint,created_at)
                        VALUES (?,?,?,?,'report','pending',?,?)
                        """, UUID.randomUUID(), session, user, UUID.randomUUID(), "a".repeat(64),
                        OffsetDateTime.now().plusNanos(index));
            }

            try (Connection first = connect(url); Connection second = connect(url)) {
                first.setAutoCommit(false);
                second.setAutoCommit(false);
                UUID oldest;
                try (Statement statement = first.createStatement();
                        ResultSet rows = statement.executeQuery(
                                "SELECT id FROM external_operations ORDER BY created_at,id LIMIT 1 FOR UPDATE")) {
                    rows.next();
                    oldest = rows.getObject(1, UUID.class);
                }

                ExecutorService pool = Executors.newSingleThreadExecutor();
                CountDownLatch started = new CountDownLatch(1);
                try {
                    Future<UUID> result = pool.submit(() -> {
                        started.countDown();
                        return claim(second);
                    });
                    started.await(1, TimeUnit.SECONDS);
                    Thread.sleep(200);
                    assertThat(result).isNotDone();

                    execute(first, """
                            UPDATE external_operations
                            SET status='running',lease_token=?,lease_expires_at=now()+interval '1 minute'
                            WHERE id=?
                            """, UUID.randomUUID(), oldest);
                    first.commit();

                    assertThat(result.get(5, TimeUnit.SECONDS)).isNull();
                    second.commit();
                } finally {
                    pool.shutdownNow();
                }
            }
        }
    }

    private static UUID claim(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement();
                ResultSet rows = statement.executeQuery("""
                        UPDATE external_operations SET status='running'
                        WHERE id=(SELECT id FROM external_operations
                                  WHERE status='pending'
                                  ORDER BY created_at,id LIMIT 1)
                          AND status='pending'
                        RETURNING id
                        """)) {
            return rows.next() ? rows.getObject(1, UUID.class) : null;
        }
    }

    private static void execute(Connection connection, String sql, Object... values) throws SQLException {
        try (PreparedStatement statement = connection.prepareStatement(sql)) {
            for (int index = 0; index < values.length; index++) {
                statement.setObject(index + 1, values[index]);
            }
            statement.executeUpdate();
        }
    }

    private static Connection connect(String url) throws SQLException {
        return DriverManager.getConnection(url, PostgresContainerSupport.POSTGRES.getUsername(),
                PostgresContainerSupport.POSTGRES.getPassword());
    }
}
