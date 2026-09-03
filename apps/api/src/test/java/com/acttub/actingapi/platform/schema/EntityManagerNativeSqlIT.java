package com.acttub.actingapi.platform.schema;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.auth.schema.UserEntity;
import com.acttub.actingapi.feature.push.schema.PushTokenEntity;
import com.acttub.actingapi.support.PostgresContainerSupport;
import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.persistence.Query;
import jakarta.persistence.Tuple;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Hibernate native SQL이 SOMA-460의 PostgreSQL 불변식을 표현할 수 있는지 실 DB에서 증명한다. */
@SpringBootTest(properties = "JWT_SECRET=test-secret")
class EntityManagerNativeSqlIT {

    private static final String LOCK_WAITER_APPLICATION_NAME = "soma460-native-lock-waiter";

    @DynamicPropertySource
    static void datasource(DynamicPropertyRegistry registry) {
        String database = PostgresContainerSupport.createDatabaseName("entity_manager_native_sql_it");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(database));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @PersistenceContext
    EntityManager entityManager;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    PlatformTransactionManager transactionManager;

    @Test
    void updateReturningMapsZeroOneAndCompositeRowsByAlias() {
        UUID userId = insertUser("native-returning@example.test");

        inTransaction(() -> {
            List<Tuple> noRows = updateUserReturning(UUID.randomUUID(), "없음");
            assertThat(noRows).isEmpty();

            List<Tuple> oneRow = updateUserReturning(userId, "바뀐 이름");
            assertThat(oneRow).singleElement().satisfies(row -> {
                assertThat(row.get("id", UUID.class)).isEqualTo(userId);
                assertThat(row.get("nickname", String.class)).isEqualTo("바뀐 이름");
                assertThat(row.get("status", String.class)).isEqualTo("active");
            });
        });
    }

    @Test
    void pushUpsertReturnsDatabaseGeneratedIdAndRebindsTheSameRow() {
        UUID firstUser = insertUser("native-push-first@example.test");
        UUID secondUser = insertUser("native-push-second@example.test");
        String token = "ExponentPushToken[native-returning]";

        UUID firstId = inTransaction(() -> upsertPush(firstUser, token, "ios"));
        inTransaction(() -> assertThat(insertPushIfAbsent(firstUser, token, "ios")).isEmpty());
        UUID reboundId = inTransaction(() -> upsertPush(secondUser, token, "android"));

        assertThat(reboundId).isEqualTo(firstId);
        inTransaction(() -> {
            entityManager.clear();
            PushTokenEntity loaded = entityManager.find(PushTokenEntity.class, firstId);
            assertThat(loaded.getId()).isEqualTo(firstId);
            assertThat(loaded.getUserId()).isEqualTo(secondUser);
            assertThat(loaded.getToken()).isEqualTo(token);
            assertThat(loaded.getPlatform()).isEqualTo("android");
            assertThat(loaded.getCreatedAt()).isNotNull();
            assertThat(loaded.getUpdatedAt()).isNotNull();
        });
    }

    @Test
    void nativeMutationParticipatesInTheSurroundingTransaction() {
        UUID userId = insertUser("native-transaction@example.test");

        TransactionTemplate transaction = transaction();
        transaction.executeWithoutResult(status -> {
            updateNickname(userId, "롤백 이름");
            status.setRollbackOnly();
        });
        assertThat(nickname(userId)).isNull();

        transaction.executeWithoutResult(status -> updateNickname(userId, "커밋 이름"));
        assertThat(nickname(userId)).isEqualTo("커밋 이름");
    }

    @Test
    void rowLockBlocksAnotherEntityManagerTransaction() throws Exception {
        UUID userId = insertUser("native-lock@example.test");
        CountDownLatch locked = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        CountDownLatch attempting = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);

        try {
            Future<?> holder = pool.submit(() -> inTransaction(() -> {
                lockUser(userId);
                locked.countDown();
                await(release);
            }));
            assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();

            Future<?> waiter = pool.submit(() -> inTransaction(() -> {
                identifyLockWaiter();
                attempting.countDown();
                lockUser(userId);
            }));
            assertThat(attempting.await(5, TimeUnit.SECONDS)).isTrue();
            assertThat(waitForBlockedTransaction()).isTrue();
            assertThat(waiter.isDone()).isFalse();

            release.countDown();
            holder.get(5, TimeUnit.SECONDS);
            waiter.get(5, TimeUnit.SECONDS);
        } finally {
            release.countDown();
            pool.shutdownNow();
        }
    }

    @Test
    void explicitFlushAndClearPreserveNativeMutationOrderingAndVisibility() {
        UUID userId = UUID.randomUUID();

        inTransaction(() -> {
            UserEntity managed = new UserEntity(
                    userId, "native-cache@example.test", UserStatus.ACTIVE, "쓰기 전");
            entityManager.persist(managed);
            entityManager.flush();

            updateNickname(userId, "native 변경");
            assertThat(entityManager.find(UserEntity.class, userId).getNickname()).isEqualTo("쓰기 전");

            entityManager.clear();
            assertThat(entityManager.find(UserEntity.class, userId).getNickname()).isEqualTo("native 변경");
        });
    }

    private UUID upsertPush(UUID userId, String token, String platform) {
        List<Tuple> rows = tuples(entityManager.createNativeQuery("""
                WITH stored AS (
                    INSERT INTO push_tokens (user_id, token, platform)
                    VALUES (:userId, :token, :platform)
                    ON CONFLICT (token) DO UPDATE
                    SET user_id = EXCLUDED.user_id,
                        platform = EXCLUDED.platform,
                        updated_at = now()
                    RETURNING id, user_id, token, platform
                )
                SELECT id, user_id, token, platform FROM stored
                """, Tuple.class)
                .setParameter("userId", userId)
                .setParameter("token", token)
                .setParameter("platform", platform));
        assertThat(rows).hasSize(1);
        Tuple row = rows.getFirst();
        assertThat(row.get("user_id", UUID.class)).isEqualTo(userId);
        assertThat(row.get("token", String.class)).isEqualTo(token);
        assertThat(row.get("platform", String.class)).isEqualTo(platform);
        return row.get("id", UUID.class);
    }

    private List<Tuple> insertPushIfAbsent(UUID userId, String token, String platform) {
        return tuples(entityManager.createNativeQuery("""
                WITH inserted AS (
                    INSERT INTO push_tokens (user_id, token, platform)
                    VALUES (:userId, :token, :platform)
                    ON CONFLICT (token) DO NOTHING
                    RETURNING id, user_id, token, platform
                )
                SELECT id, user_id, token, platform FROM inserted
                """, Tuple.class)
                .setParameter("userId", userId)
                .setParameter("token", token)
                .setParameter("platform", platform));
    }

    private List<Tuple> updateUserReturning(UUID userId, String nickname) {
        return tuples(entityManager.createNativeQuery("""
                WITH changed AS (
                    UPDATE users SET nickname = :nickname
                    WHERE id = :id
                    RETURNING id, nickname, status
                )
                SELECT id, nickname, status FROM changed
                """, Tuple.class)
                .setParameter("nickname", nickname)
                .setParameter("id", userId));
    }

    private void updateNickname(UUID userId, String nickname) {
        assertThat(updateUserReturning(userId, nickname)).hasSize(1);
    }

    private void lockUser(UUID userId) {
        List<Tuple> rows = tuples(entityManager.createNativeQuery(
                "SELECT id FROM users WHERE id = :id FOR UPDATE", Tuple.class)
                .setParameter("id", userId));
        assertThat(rows).hasSize(1);
    }

    private UUID insertUser(String email) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users (id, email, status) VALUES (?, ?, 'active')", id, email);
        return id;
    }

    private String nickname(UUID userId) {
        return jdbc.queryForObject("SELECT nickname FROM users WHERE id = ?", String.class, userId);
    }

    private TransactionTemplate transaction() {
        return new TransactionTemplate(transactionManager);
    }

    private void inTransaction(Runnable work) {
        transaction().executeWithoutResult(status -> work.run());
    }

    private <T> T inTransaction(java.util.concurrent.Callable<T> work) {
        return transaction().execute(status -> {
            try {
                return work.call();
            } catch (RuntimeException exception) {
                throw exception;
            } catch (Exception exception) {
                throw new IllegalStateException(exception);
            }
        });
    }

    @SuppressWarnings("unchecked")
    private static List<Tuple> tuples(Query query) {
        return query.getResultList();
    }

    private static void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) {
                throw new IllegalStateException("latch timeout");
            }
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exception);
        }
    }

    private void identifyLockWaiter() {
        entityManager.createNativeQuery(
                "SELECT set_config('application_name', :name, true)", String.class)
                .setParameter("name", LOCK_WAITER_APPLICATION_NAME)
                .getSingleResult();
    }

    private boolean waitForBlockedTransaction() throws InterruptedException {
        for (int attempt = 0; attempt < 500; attempt++) {
            Boolean waiting = jdbc.queryForObject("""
                    SELECT EXISTS (
                        SELECT 1
                        FROM pg_stat_activity
                        WHERE datname = current_database()
                          AND application_name = ?
                          AND wait_event_type = 'Lock'
                    )
                    """, Boolean.class, LOCK_WAITER_APPLICATION_NAME);
            if (Boolean.TRUE.equals(waiting)) {
                return true;
            }
            Thread.sleep(10);
        }
        return false;
    }
}
