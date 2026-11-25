package com.acttub.actingapi.feature.support;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;

import com.acttub.actingapi.feature.support.app.SupportInquiryStore;
import com.acttub.actingapi.feature.support.app.SupportInquiryStore.Inquiry;
import com.acttub.actingapi.feature.support.app.SupportInquiryStore.NewInquiry;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 문의 저장소의 네 문장이 지금 내는 결과·잠금·경합·문장 수를 실제 PostgreSQL 에서 고정한다. 저장소를 네이티브 SQL 에서
 * JPA 로 옮길 때 같은 테스트가 그대로 통과해야 한다(apps/api/CONTRACT.md §5-9). 상태 바꾸기의 문장 수만 예외다 —
 * {@code UPDATE … RETURNING} 을 UPDATE 뒤 다시 읽기로 나누면 하나 는다.
 *
 * <p>HTTP 쪽 검증·IP 한도·응답 모양·토큰 판정은 {@link SupportInquiryIT} 가 본다. 여기서는 그 테스트가 밟지 않는 같은 시각의
 * 순서, 개수 제한, 비로그인 행, 시각의 정밀도, 없는 id, 행 잠금, 두 운영자가 함께 바꿀 때의 결과, 포트 메서드마다 나가는
 * 문장을 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.support.SupportInquiryStoreIT$Recorder"
})
class SupportInquiryStoreIT {

    /** 이 스레드가 보낸 SQL 을 모은다. 경합 쪽 스레드의 문장은 섞이지 않는다. */
    public static class Recorder implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    @Value("${spring.datasource.url}")
    private String databaseUrl;

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    SupportInquiryStore store;

    @Autowired
    PlatformTransactionManager transactionManager;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE support_inquiries");
        Recorder.STATEMENTS.get().clear();
    }

    @Test
    @DisplayName("insert 는 넘긴 값과 open 을 적고 시각을 마이크로초로 반올림한다. 비로그인·client 없음은 NULL 이다")
    void insertWritesEveryColumn() {
        UUID user = UUID.randomUUID();
        UUID signedIn = UUID.randomUUID();
        UUID anonymous = UUID.randomUUID();

        store.insert(new NewInquiry(signedIn, "billing", "a@b.co", "결제 문의 본문입니다", user, "app/1.2.3"),
                now.plusNanos(123_456_789));
        store.insert(new NewInquiry(anonymous, "other", "c@d.co", "비로그인 문의 본문입니다", null, null), now);

        assertThat(jdbc.queryForMap("SELECT * FROM support_inquiries WHERE id=?", signedIn)).satisfies(row -> {
            assertThat(row.get("category")).isEqualTo("billing");
            assertThat(row.get("email")).isEqualTo("a@b.co");
            assertThat(row.get("body")).isEqualTo("결제 문의 본문입니다");
            assertThat(row.get("user_id")).isEqualTo(user);
            assertThat(row.get("client")).isEqualTo("app/1.2.3");
            assertThat(row.get("status")).isEqualTo("open");
        });
        assertThat(jdbc.queryForObject("SELECT created_at FROM support_inquiries WHERE id=?", OffsetDateTime.class, signedIn)
                .toInstant()).isEqualTo(now.plus(123_457, ChronoUnit.MICROS));
        assertThat(jdbc.queryForMap("SELECT user_id, client, status FROM support_inquiries WHERE id=?", anonymous))
                .containsEntry("user_id", null).containsEntry("client", null).containsEntry("status", "open");
    }

    @Test
    @DisplayName("listByUser 는 그 계정의 문의만 새것부터, 같은 시각이면 id 가 큰 것부터 limit 건 낸다. 모든 칸을 읽는다")
    void listByUserOrdersNewestFirstThenByIdAndLimits() {
        UUID user = UUID.randomUUID();
        UUID other = UUID.randomUUID();
        UUID oldest = id(1);
        UUID tieLow = id(2);
        UUID tieHigh = id(3);
        store.insert(new NewInquiry(oldest, "bug", "a@b.co", "가장 오래된 문의입니다", user, "web"), now.minusSeconds(60));
        store.insert(new NewInquiry(tieLow, "bug", "a@b.co", "같은 시각 문의 하나입니다", user, null), now);
        store.insert(new NewInquiry(tieHigh, "usage", "a@b.co", "같은 시각 문의 둘입니다", user, null), now);
        store.insert(new NewInquiry(id(4), "bug", "x@y.co", "다른 계정의 문의입니다", other, null), now.plusSeconds(60));
        store.insert(new NewInquiry(id(5), "bug", "x@y.co", "비로그인 문의입니다", null, null), now.plusSeconds(60));

        assertThat(store.listByUser(user, 20)).extracting(Inquiry::id).containsExactly(tieHigh, tieLow, oldest);
        assertThat(store.listByUser(user, 2)).extracting(Inquiry::id).containsExactly(tieHigh, tieLow);
        assertThat(store.listByUser(UUID.randomUUID(), 20)).isEmpty();
        assertThat(store.listByUser(user, 20).getLast()).isEqualTo(new Inquiry(
                oldest, "bug", "a@b.co", "가장 오래된 문의입니다", user, "web", "open", now.minusSeconds(60)));
    }

    @Test
    @DisplayName("list 는 status 가 null 이면 전체, 아니면 그 상태만 새것부터(같은 시각이면 id 가 큰 것부터) limit 건 낸다")
    void listFiltersByStatusOrReturnsAll() {
        store.insert(new NewInquiry(id(1), "bug", "a@b.co", "닫을 문의 본문입니다", null, null), now.minusSeconds(60));
        store.insert(new NewInquiry(id(2), "bug", "a@b.co", "열린 문의 하나입니다", null, null), now);
        store.insert(new NewInquiry(id(3), "bug", "a@b.co", "열린 문의 둘입니다", UUID.randomUUID(), null), now);
        store.setStatus(id(1), "closed");

        assertThat(store.list(null, 200)).extracting(Inquiry::id).containsExactly(id(3), id(2), id(1));
        assertThat(store.list(null, 1)).extracting(Inquiry::id).containsExactly(id(3));
        assertThat(store.list("open", 200)).extracting(Inquiry::id).containsExactly(id(3), id(2));
        assertThat(store.list("closed", 200)).singleElement().isEqualTo(new Inquiry(
                id(1), "bug", "a@b.co", "닫을 문의 본문입니다", null, null, "closed", now.minusSeconds(60)));
    }

    @Test
    @DisplayName("setStatus 는 그 행만 바꾸고 바뀐 행 전체를 낸다. 같은 값이면 그대로 내고, 없는 id 는 비어 있다")
    void setStatusReturnsTheChangedRow() {
        UUID user = UUID.randomUUID();
        store.insert(new NewInquiry(id(1), "refund", "a@b.co", "환불 문의 본문입니다", user, "app"), now);
        store.insert(new NewInquiry(id(2), "bug", "a@b.co", "건드리지 않을 문의입니다", null, null), now);

        assertThat(store.setStatus(id(1), "closed")).contains(new Inquiry(
                id(1), "refund", "a@b.co", "환불 문의 본문입니다", user, "app", "closed", now));
        assertThat(store.setStatus(id(1), "closed")).map(Inquiry::status).contains("closed");
        assertThat(store.setStatus(UUID.randomUUID(), "closed")).isEmpty();

        assertThat(jdbc.queryForList("SELECT status FROM support_inquiries ORDER BY id", String.class))
                .containsExactly("closed", "open");
    }

    @Test
    @DisplayName("setStatus 가 쓴 행은 트랜잭션 끝까지 잠겨 있고 그 안에서 낸 값은 방금 쓴 값이다. 두 운영자가 함께 바꾸면 뒤의 것이 앞의 커밋을 기다렸다가 자기 값을 쓰고 낸다")
    void twoOperatorsChangingTheSameInquiry() throws Exception {
        store.insert(new NewInquiry(id(1), "bug", "a@b.co", "두 운영자가 다투는 문의입니다", null, null), now);
        TransactionTemplate transaction = new TransactionTemplate(transactionManager);
        CountDownLatch firstWrote = new CountDownLatch(1);
        CountDownLatch secondWaits = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);
        try {
            Future<Optional<Inquiry>> first = pool.submit(() -> transaction.execute(tx -> {
                Optional<Inquiry> wrote = store.setStatus(id(1), "closed");
                firstWrote.countDown();
                await(secondWaits);
                assertThat(store.list(null, 10)).singleElement().extracting(Inquiry::status)
                        .as("같은 트랜잭션에서 다시 읽어도 방금 쓴 값이다").isEqualTo("closed");
                return wrote;
            }));
            await(firstWrote);
            Future<Optional<Inquiry>> second = pool.submit(() -> store.setStatus(id(1), "open"));
            String waiting = awaitStatementWaitingOn("support_inquiries");
            assertThat(waiting.toLowerCase()).startsWith("update support_inquiries");
            secondWaits.countDown();

            assertThat(first.get(20, TimeUnit.SECONDS)).map(Inquiry::status).contains("closed");
            assertThat(second.get(20, TimeUnit.SECONDS)).map(Inquiry::status).contains("open");
        } finally {
            pool.shutdownNow();
        }
        assertThat(jdbc.queryForObject("SELECT status FROM support_inquiries WHERE id=?", String.class, id(1)))
                .isEqualTo("open");
    }

    @Test
    @DisplayName("setStatus 의 잠금은 FOR NO KEY UPDATE 세기다 — 바깥 연결의 FOR KEY SHARE 는 막지 않고 FOR SHARE 뒤에서는 기다린다")
    void setStatusLocksLikeAnUpdateOfANonKeyColumn() throws Exception {
        store.insert(new NewInquiry(id(1), "bug", "a@b.co", "잠금 세기를 볼 문의입니다", null, null), now);
        ExecutorService pool = Executors.newSingleThreadExecutor();
        try (Connection probe = DriverManager.getConnection(databaseUrl,
                PostgresContainerSupport.POSTGRES.getUsername(), PostgresContainerSupport.POSTGRES.getPassword())) {
            probe.setAutoCommit(false);
            lock(probe, "FOR KEY SHARE");
            assertThat(pool.submit(() -> store.setStatus(id(1), "closed")).get(20, TimeUnit.SECONDS))
                    .map(Inquiry::status).as("FOR KEY SHARE 와는 겹치지 않는다").contains("closed");
            probe.rollback();

            lock(probe, "FOR SHARE");
            Future<Optional<Inquiry>> blocked = pool.submit(() -> store.setStatus(id(1), "open"));
            String waiting = awaitStatementWaitingOn("support_inquiries");
            probe.rollback();

            assertThat(waiting.toLowerCase()).startsWith("update support_inquiries");
            assertThat(blocked.get(20, TimeUnit.SECONDS)).map(Inquiry::status).contains("open");
        } finally {
            pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("포트 메서드마다 나가는 문장: 넣기는 INSERT 하나, 두 목록은 SELECT 하나씩, 상태 바꾸기는 UPDATE … RETURNING 하나다")
    void eachPortMethodSendsTheseStatements() {
        assertThat(statementsOf(() -> {
            store.insert(new NewInquiry(id(1), "bug", "a@b.co", "문장을 셀 문의입니다", UUID.randomUUID(), null), now);
            return null;
        })).singleElement().satisfies(sql -> assertThat(sql).matches("(?is)insert\\s+into\\s+support_inquiries\\b.*"));
        assertThat(statementsOf(() -> store.listByUser(UUID.randomUUID(), 20))).singleElement()
                .satisfies(sql -> assertThat(sql).matches("(?is)select\\s.*\\sfrom\\s+support_inquiries\\b.*"));
        assertThat(statementsOf(() -> store.list(null, 20))).singleElement()
                .satisfies(sql -> assertThat(sql).matches("(?is)select\\s.*\\sfrom\\s+support_inquiries\\b.*"));
        assertThat(statementsOf(() -> store.list("open", 20))).singleElement()
                .satisfies(sql -> assertThat(sql).matches("(?is)select\\s.*\\sfrom\\s+support_inquiries\\b.*"));
        assertThat(statementsOf(() -> store.setStatus(id(1), "closed"))).singleElement()
                .satisfies(sql -> assertThat(sql).matches("(?is)update\\s+support_inquiries\\b.*\\sreturning\\s.*"));
        assertThat(statementsOf(() -> store.setStatus(UUID.randomUUID(), "closed"))).singleElement()
                .satisfies(sql -> assertThat(sql).matches("(?is)update\\s+support_inquiries\\b.*"));
    }

    private static UUID id(int n) {
        return UUID.fromString("00000000-0000-0000-0000-%012d".formatted(n));
    }

    private void lock(Connection probe, String strength) throws Exception {
        try (PreparedStatement statement = probe.prepareStatement(
                "SELECT 1 FROM support_inquiries WHERE id=? " + strength)) {
            statement.setObject(1, id(1));
            statement.execute();
        }
    }

    private static void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(20, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exc);
        }
    }

    private List<String> statementsOf(Supplier<?> call) {
        Recorder.STATEMENTS.get().clear();
        call.get();
        List<String> sent = List.copyOf(Recorder.STATEMENTS.get());
        Recorder.STATEMENTS.get().clear();
        return sent;
    }

    private String awaitStatementWaitingOn(String table) throws Exception {
        Instant deadline = Instant.now().plusSeconds(10);
        while (Instant.now().isBefore(deadline)) {
            List<String> waiting = jdbc.queryForList("""
                    SELECT query FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event_type='Lock'
                      AND query ILIKE ?
                    """, String.class, "%" + table + "%");
            if (!waiting.isEmpty()) {
                return waiting.getFirst().strip();
            }
            Thread.sleep(10);
        }
        throw new AssertionError("상태 바꾸기가 앞의 잠금 뒤에서 기다리지 않았다");
    }
}
