package com.acttub.actingapi.upload;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;

import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(properties = "JWT_SECRET=test-secret")
class UploadStoreIT {
    private static final UUID USER_ID =
            UUID.fromString("00000000-0000-4000-8000-000000000101");

    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("upload_store");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    UploadStore store;

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        jdbc.update("INSERT INTO users(id,status) VALUES (?,'active'::user_status_t)", USER_ID);
    }

    @Test
    void concurrentConditionalFinalizationReturnsTheUpdatedRowExactlyOnce() throws Exception {
        UploadStore.UploadIntentRow intent = store.create(
                USER_ID,
                "users/" + USER_ID + "/uploads/concurrent.mp4",
                "video/mp4",
                12,
                null,
                Instant.now().plusSeconds(1800));
        Instant now = Instant.now();
        CountDownLatch start = new CountDownLatch(1);
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var first = pool.submit(() -> {
                start.await();
                return store.finalizeIntent(USER_ID, intent.id(), "etag-a", now);
            });
            var second = pool.submit(() -> {
                start.await();
                return store.finalizeIntent(USER_ID, intent.id(), "etag-b", now);
            });
            start.countDown();

            assertThat(java.util.stream.Stream.of(first.get(), second.get())
                    .filter(java.util.Objects::nonNull))
                    .hasSize(1);
        }
        assertThat(jdbc.queryForObject(
                "SELECT status::text FROM upload_intents WHERE id=?", String.class, intent.id()))
                .isEqualTo("finalized");
    }
}
