package com.acttub.actingapi.feature.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import com.acttub.actingapi.feature.billing.app.BillingRepository;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

/** 창립 멤버 번호(SOMA-861)를 실제 Postgres 로 본다: 동시 결제에도 번호가 겹치지 않고 100을 넘지 않으며, DB 제약이 마지막 보루다. */
@SpringBootTest(properties = {
        "JWT_SECRET=test-secret",
        "ACCOUNT_CLEANUP_ENABLED=false",
        "ACCOUNT_HOUSEKEEPING_ENABLED=false",
        "BILLING_RENEWAL_POLL_MS=3600000",
        "BILLING_RENEWAL_INITIAL_DELAY_MS=3600000"})
class FoundingMemberIT {
    @DynamicPropertySource
    static void database(DynamicPropertyRegistry registry) {
        String name = PostgresContainerSupport.createDatabaseName("billing_founding");
        registry.add("spring.datasource.url", () -> PostgresContainerSupport.jdbcUrlFor(name));
        registry.add("spring.datasource.username", PostgresContainerSupport.POSTGRES::getUsername);
        registry.add("spring.datasource.password", PostgresContainerSupport.POSTGRES::getPassword);
    }

    @Autowired
    BillingRepository repository;
    @Autowired
    JdbcTemplate jdbc;

    @BeforeEach
    void clean() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        jdbc.execute("DELETE FROM founding_members");
    }

    private UUID user(String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status) VALUES (?,?)", id, status);
        return id;
    }

    @Test
    @DisplayName("한 사람은 번호를 한 번만 받고 두 번째 호출은 같은 번호를 바꾸지 않는다")
    void oncePerUser() {
        UUID id = user("active");
        assertThat(repository.assignFoundingNumber(id, "toss", Instant.now())).contains(1);
        assertThat(repository.assignFoundingNumber(id, "apple", Instant.now())).isEmpty();
        assertThat(repository.foundingNumber(id)).contains(1);
        assertThat(repository.foundingRemaining()).isEqualTo(99);
    }

    @Test
    @DisplayName("활성 사용자가 아니면 번호를 받지 않는다")
    void inactiveUsersAreSkipped() {
        assertThat(repository.assignFoundingNumber(user("deactivated"), "apple", Instant.now())).isEmpty();
        assertThat(repository.assignFoundingNumber(UUID.randomUUID(), "apple", Instant.now())).isEmpty();
        assertThat(repository.foundingRemaining()).isEqualTo(100);
    }

    @Test
    @DisplayName("동시에 150명이 결제해도 1~100이 한 번씩만 나가고 나머지 50명은 받지 않는다")
    void concurrentPaymentsNeverDuplicateOrExceed() throws Exception {
        List<UUID> users = new ArrayList<>();
        for (int i = 0; i < 150; i++) {
            users.add(user("active"));
        }
        ExecutorService pool = Executors.newFixedThreadPool(16);
        CountDownLatch start = new CountDownLatch(1);
        List<Future<java.util.Optional<Integer>>> results = new ArrayList<>();
        for (UUID id : users) {
            results.add(pool.submit(() -> {
                start.await();
                return repository.assignFoundingNumber(id, "toss", Instant.now());
            }));
        }
        start.countDown();
        List<Integer> numbers = new ArrayList<>();
        for (Future<java.util.Optional<Integer>> result : results) {
            result.get().ifPresent(numbers::add);
        }
        pool.shutdown();
        assertThat(numbers).hasSize(100).doesNotHaveDuplicates().allMatch(n -> n >= 1 && n <= 100);
        assertThat(repository.foundingRemaining()).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM founding_members", Integer.class)).isEqualTo(100);
    }

    @Test
    @DisplayName("탈퇴로 사람이 지워져도 번호는 비우지 않아 자리가 다시 열리지 않는다")
    void deletedUserKeepsTheSlotUsed() {
        UUID id = user("active");
        repository.assignFoundingNumber(id, "toss", Instant.now());
        jdbc.update("DELETE FROM users WHERE id=?", id);
        assertThat(repository.foundingRemaining()).isEqualTo(99);
        assertThat(repository.assignFoundingNumber(user("active"), "toss", Instant.now())).contains(2);
    }

    @Test
    @DisplayName("DB 제약: 101번 번호·같은 번호·한 사람 두 번호는 직접 넣어도 거절된다")
    void databaseConstraintsRejectBadRows() {
        UUID id = user("active");
        jdbc.update("INSERT INTO founding_members(number,user_id,provider) VALUES (1,?, 'toss')", id);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO founding_members(number,user_id,provider) VALUES (101,?, 'toss')", user("active")))
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO founding_members(number,user_id,provider) VALUES (1,?, 'toss')", user("active")))
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO founding_members(number,user_id,provider) VALUES (2,?, 'toss')", id))
                .isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
    }
}
