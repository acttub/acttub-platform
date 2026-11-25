package com.acttub.actingapi.feature.billing;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.billing.app.BillingRepository;
import com.acttub.actingapi.feature.billing.app.BillingRepository.Checkout;
import com.acttub.actingapi.feature.billing.app.BillingRepository.Payment;
import com.acttub.actingapi.feature.billing.app.BillingRepository.StoreState;
import com.acttub.actingapi.feature.billing.app.BillingRepository.Subscription;
import com.acttub.actingapi.feature.billing.app.BillingRules;
import org.assertj.core.api.SoftAssertions;
import org.hibernate.resource.jdbc.spi.StatementInspector;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 결제 저장소({@code PostgresBillingRepository})가 내는 결과·멱등·경합·문장 수를 실제 PostgreSQL 에서 고정한다. 자기 표(구독·카드
 * 등록 창·결제·Pro 부여)만 쓰는 문장을 네이티브 SQL 에서 JPA 로 옮길 때 네이티브 구현에서 먼저 통과시킨 이 테스트가 그대로
 * 통과해야 한다(apps/api/CONTRACT.md §5-9). 다른 기능의 표를 쓰는 문장과 점유 조건부 갱신은 네이티브로 남겨 문장 테스트에서만
 * 본다.
 *
 * <p>HTTP 를 거친 카드 등록·결제·해지·갱신·스토어 웹훅·운영 화면은 {@link BillingEndpointIT}·{@link StoreBillingEndpointIT}·
 * {@link BillingAdminEndpointIT} 가 본다. 여기서는 그 테스트가 밟지 않는 행의 모든 칸과 시각의 정밀도, 상태를 바꾸는 문장마다
 * 같은 요청이 두 번 올 때(멱등)와 조건이 맞지 않을 때, 같은 행을 두 요청이 함께 바꿀 때(카드 등록 창 집기, 해지, 해지와 갱신,
 * 같은 주문 번호의 결제 기록), 포트 메서드마다 나가는 문장을 본다.
 */
@SpringBootTest(properties = {
    "JWT_SECRET=test-secret",
    "spring.jpa.properties.hibernate.session_factory.statement_inspector="
            + "com.acttub.actingapi.feature.billing.BillingRepositoryIT$Recorder"
})
// 이 클래스만 쓰는 설정(StatementInspector)이라 끝나면 닫는다.
@DirtiesContext(classMode = DirtiesContext.ClassMode.AFTER_CLASS)
class BillingRepositoryIT {

    /** 이 스레드가 보낸 SQL 을 모은다. 경합 쪽 스레드의 문장은 섞이지 않는다. */
    public static class Recorder implements StatementInspector {
        private static final ThreadLocal<List<String>> STATEMENTS = ThreadLocal.withInitial(ArrayList::new);

        @Override
        public String inspect(String sql) {
            STATEMENTS.get().add(sql);
            return sql;
        }
    }

    @Autowired
    JdbcTemplate jdbc;

    @Autowired
    BillingRepository billing;

    @Autowired
    PlatformTransactionManager transactionManager;

    private final Instant now = Instant.parse("2026-11-25T03:00:00Z");

    @BeforeEach
    void setUp() {
        jdbc.execute("TRUNCATE TABLE users RESTART IDENTITY CASCADE");
        Recorder.STATEMENTS.get().clear();
    }

    // ---- 구독 읽기 ----

    @Test
    @DisplayName("find·findById 는 구독의 모든 칸을 읽는다. 없으면 비어 있다")
    void findReadsEveryColumn() {
        UUID user = member();
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO billing_subscriptions(id,user_id,status,provider,customer_key,billing_key,card_company,card_number,
                    amount,current_period_start,current_period_end,canceled_at,retry_count,next_retry_at,plan)
                VALUES (?,?,'past_due','toss','ck-1','k1:sealed','신한','4321-****',32500,?,?,?,2,?,'yearly')
                """, id, user, at(now.minus(Duration.ofDays(365))), at(now), at(now.minusSeconds(60)), at(now.plusSeconds(3600)));

        Subscription expected = new Subscription(id, user, BillingRules.Status.PAST_DUE, "ck-1", "k1:sealed", "신한",
                "4321-****", 32_500, now.minus(Duration.ofDays(365)), now, now.minusSeconds(60), 2, now.plusSeconds(3600),
                "toss", BillingRules.Plan.YEARLY);
        assertThat(billing.find(user)).contains(expected);
        assertThat(billing.findById(id)).contains(expected);
        assertThat(billing.find(UUID.randomUUID())).isEmpty();
        assertThat(billing.findById(UUID.randomUUID())).isEmpty();
    }

    @Test
    @DisplayName("grantEnd 는 지금 걸친 부여 가운데 가장 늦은 끝이다. 시작이 지금이면 들고 끝이 지금이면 빠진다. 다른 회원의 부여는 보지 않는다")
    void grantEndPicksTheLatestCurrentGrant() {
        UUID user = member();
        grant(user, now, now.plusSeconds(60));
        grant(user, now.minusSeconds(600), now.plusSeconds(120));
        grant(user, now.minusSeconds(600), now);
        grant(user, now.plusSeconds(1), now.plusSeconds(999));
        grant(member(), now.minusSeconds(600), now.plusSeconds(9_999));

        assertThat(billing.grantEnd(user, now)).contains(now.plusSeconds(120));
        assertThat(billing.grantEnd(user, now.plusSeconds(120))).as("끝과 같은 시각은 빠진다").contains(now.plusSeconds(999));
        assertThat(billing.grantEnd(user, now.plusSeconds(999))).isEmpty();
        assertThat(billing.grantEnd(member(), now)).isEmpty();
    }

    // ---- 카드 등록 창 ----

    @Test
    @DisplayName("openCheckout 은 모든 칸을 open 으로 적고, findOpenCheckout 은 시한 전의 open 창만 낸다")
    void openAndFindCheckout() {
        UUID user = member();
        Checkout checkout = checkout(user, "state-a", now.plusNanos(1_500).plusSeconds(600));

        billing.openCheckout(checkout);

        Checkout stored = new Checkout(checkout.id(), user, "state-a", BillingRules.Purpose.CHANGE_CARD, "ck-" + user,
                "order-" + checkout.id(), now.plusSeconds(600).plus(2, ChronoUnit.MICROS), BillingRules.Plan.YEARLY);
        assertThat(billing.findOpenCheckout("state-a", now)).contains(stored);
        assertThat(billing.findOpenCheckout("state-a", stored.expiresAt())).as("시한과 같은 시각은 지났다").isEmpty();
        assertThat(billing.findOpenCheckout("state-b", now)).isEmpty();
        assertThat(jdbc.queryForMap("SELECT status, result_code FROM billing_checkouts WHERE id=?", checkout.id()))
                .containsEntry("status", "open").containsEntry("result_code", null);
    }

    @Test
    @DisplayName("claimCheckout 은 시한 전의 open 창을 processing 으로 바꾸고 그 창을 낸다. 두 번째·시한 지난 창·없는 창은 비어 있다. finishCheckout 은 상태·결과·updated_at 을 적는다")
    void claimAndFinishCheckout() {
        UUID user = member();
        Checkout checkout = checkout(user, "state-claim", now.plusSeconds(600));
        billing.openCheckout(checkout);
        Checkout expired = checkout(user, "state-expired", now);
        billing.openCheckout(expired);

        assertThat(billing.claimCheckout("state-claim", now.plusNanos(999))).contains(checkout);
        assertThat(billing.claimCheckout("state-claim", now)).as("두 번째는 이미 processing").isEmpty();
        assertThat(billing.claimCheckout("state-expired", now)).isEmpty();
        assertThat(billing.claimCheckout("state-none", now)).isEmpty();
        assertThat(jdbc.queryForObject("SELECT status FROM billing_checkouts WHERE id=?", String.class, checkout.id()))
                .isEqualTo("processing");
        assertThat(instant("SELECT updated_at FROM billing_checkouts WHERE id=?", checkout.id()))
                .isEqualTo(now.plus(1, ChronoUnit.MICROS));
        assertThat(jdbc.queryForObject("SELECT status FROM billing_checkouts WHERE id=?", String.class, expired.id()))
                .isEqualTo("open");

        billing.finishCheckout(checkout.id(), "failed", "INVALID_CARD", now.plusSeconds(5));
        billing.finishCheckout(checkout.id(), "failed", "INVALID_CARD", now.plusSeconds(5));
        assertThat(jdbc.queryForMap("SELECT status, result_code FROM billing_checkouts WHERE id=?", checkout.id()))
                .containsEntry("status", "failed").containsEntry("result_code", "INVALID_CARD");
        assertThat(instant("SELECT updated_at FROM billing_checkouts WHERE id=?", checkout.id())).isEqualTo(now.plusSeconds(5));
    }

    @Test
    @DisplayName("같은 창을 두 요청이 함께 집으면 뒤의 UPDATE 가 앞의 커밋을 기다렸다가 비어 있다. 앞의 것이 되돌리면 뒤의 것이 집는다")
    void twoClaimsOfTheSameCheckout() throws Exception {
        UUID user = member();
        Checkout committed = checkout(user, "state-race", now.plusSeconds(600));
        billing.openCheckout(committed);
        Race<Optional<Checkout>> first = holdOpen(() -> billing.claimCheckout("state-race", now));
        try {
            Future<Optional<Checkout>> later = first.pool.submit(() -> billing.claimCheckout("state-race", now));
            assertThat(awaitStatementWaitingOn("billing_checkouts")).startsWith("update billing_checkouts");
            first.commit();
            assertThat(first.result()).contains(committed);
            assertThat(later.get(20, TimeUnit.SECONDS)).isEmpty();
        } finally {
            first.pool.shutdownNow();
        }

        Checkout undone = checkout(user, "state-undo", now.plusSeconds(600));
        billing.openCheckout(undone);
        Race<Optional<Checkout>> rolledBack = holdOpen(() -> billing.claimCheckout("state-undo", now));
        try {
            Future<Optional<Checkout>> later = rolledBack.pool.submit(() -> billing.claimCheckout("state-undo", now));
            awaitStatementWaitingOn("billing_checkouts");
            rolledBack.rollback();
            assertThat(later.get(20, TimeUnit.SECONDS)).contains(undone);
        } finally {
            rolledBack.pool.shutdownNow();
        }
    }

    // ---- 카드 저장과 요금제 ----

    @Test
    @DisplayName("saveCard 는 처음이면 expired·toss·월 금액으로 넣고, 다시 오면 같은 행의 카드·고객 키와 updated_at 만 바꾸며 스토어 칸을 비운다(상태·요금제·금액·created_at 은 둔다). 활성이 아닌 계정은 null 이고 쓰지 않는다")
    void saveCardInsertsThenRebindsTheSameRow() {
        UUID user = member();
        UUID id = billing.saveCard(user, "ck-1", "k1:first", "신한", "1111-****", now.plusNanos(1_500));

        Map<String, Object> first = jdbc.queryForMap("SELECT * FROM billing_subscriptions WHERE user_id=?", user);
        assertThat(first).containsEntry("id", id).containsEntry("status", "expired").containsEntry("provider", "toss")
                .containsEntry("customer_key", "ck-1").containsEntry("billing_key", "k1:first")
                .containsEntry("card_company", "신한").containsEntry("card_number", "1111-****").containsEntry("amount", 3900)
                .containsEntry("plan", "monthly").containsEntry("retry_count", 0);
        assertThat(instant("SELECT created_at FROM billing_subscriptions WHERE id=?", id)).isEqualTo(now.plus(2, ChronoUnit.MICROS));
        assertThat(instant("SELECT updated_at FROM billing_subscriptions WHERE id=?", id)).isEqualTo(now.plus(2, ChronoUnit.MICROS));

        jdbc.update("""
                UPDATE billing_subscriptions SET status='active', provider='apple', plan='yearly', amount=32500,
                    store_product_id='pro_yearly', store_transaction_id='txn-1'
                WHERE id=?
                """, id);
        assertThat(billing.saveCard(user, "ck-2", "k1:second", "국민", "2222-****", now.plusSeconds(60))).isEqualTo(id);
        assertThat(billing.saveCard(user, "ck-2", "k1:second", "국민", "2222-****", now.plusSeconds(60)))
                .as("같은 요청이 두 번 와도 같은 행").isEqualTo(id);

        assertThat(jdbc.queryForMap("SELECT * FROM billing_subscriptions WHERE user_id=?", user))
                .containsEntry("id", id).containsEntry("status", "active").containsEntry("provider", "toss")
                .containsEntry("plan", "yearly").containsEntry("amount", 32500)
                .containsEntry("store_product_id", null).containsEntry("store_transaction_id", null)
                .containsEntry("customer_key", "ck-2").containsEntry("billing_key", "k1:second")
                .containsEntry("card_company", "국민").containsEntry("card_number", "2222-****");
        assertThat(instant("SELECT created_at FROM billing_subscriptions WHERE id=?", id)).isEqualTo(now.plus(2, ChronoUnit.MICROS));
        assertThat(instant("SELECT updated_at FROM billing_subscriptions WHERE id=?", id)).isEqualTo(now.plusSeconds(60));

        UUID gone = member();
        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", gone);
        assertThat(billing.saveCard(gone, "ck-3", "k1:x", "신한", "3", now)).isNull();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM billing_subscriptions WHERE user_id=?", Integer.class, gone)).isZero();
    }

    @Test
    @DisplayName("choosePlan 은 toss 의 expired 구독에서만 요금제·금액·updated_at 을 바꾼다. 같은 요청이 두 번 와도 같다")
    void choosePlanOnlyBeforePaying() {
        UUID expired = subscription(member(), "expired", "toss", null);
        UUID active = subscription(member(), "active", "toss", now);
        UUID store = subscription(member(), "expired", "apple", null);

        for (int i = 0; i < 2; i++) {
            for (UUID id : List.of(expired, active, store)) {
                billing.choosePlan(id, BillingRules.Plan.YEARLY, now.plusSeconds(5));
            }
        }

        assertThat(planAndAmount(expired)).isEqualTo("yearly 32500");
        assertThat(planAndAmount(active)).isEqualTo("monthly 3900");
        assertThat(planAndAmount(store)).isEqualTo("monthly 3900");
        assertThat(instant("SELECT updated_at FROM billing_subscriptions WHERE id=?", expired)).isEqualTo(now.plusSeconds(5));
        assertThat(instant("SELECT updated_at FROM billing_subscriptions WHERE id=?", active)).isEqualTo(now);
    }

    // ---- 구독 상태 ----

    @Test
    @DisplayName("activate 는 활성 계정이면 active·기간을 적고 해지·재시도를 비운다. 두 번 와도 true 이고 같다. 활성이 아닌 계정은 false 이고 바꾸지 않는다. 없는 구독은 예외다")
    void activateSetsAPaidPeriodForActiveAccounts() {
        UUID user = member();
        UUID id = subscription(user, "past_due", "toss", now);
        jdbc.update("UPDATE billing_subscriptions SET canceled_at=?, retry_count=2, next_retry_at=? WHERE id=?",
                at(now), at(now.plusSeconds(60)), id);
        Instant end = now.plus(Duration.ofDays(30));

        assertThat(billing.activate(id, now, end, now.plusSeconds(1))).isTrue();
        assertThat(billing.activate(id, now, end, now.plusSeconds(1))).isTrue();

        assertThat(state(id)).isEqualTo("active " + now + " " + end + " - 0 -");
        UUID gone = member();
        UUID goneId = subscription(gone, "expired", "toss", null);
        jdbc.update("UPDATE users SET status='deactivated' WHERE id=?", gone);
        assertThat(billing.activate(goneId, now, end, now)).isFalse();
        assertThat(state(goneId)).startsWith("expired");
        assertThatThrownBy(() -> billing.activate(UUID.randomUUID(), now, end, now))
                .as("없는 구독은 예외다").isExactlyInstanceOf(EmptyResultDataAccessException.class);
    }

    @Test
    @DisplayName("advance 는 기간 끝이 넘긴 시작과 같은 active·canceled·past_due 만 다음 기간으로 넘긴다. canceled 는 canceled 로 남는다. 같은 시작으로 두 번 오면 두 번째는 바꾸지 않는다")
    void advanceMovesOnlyTheMatchingPeriodOnce() {
        Instant start = now;
        Instant end = now.plus(Duration.ofDays(30));
        UUID active = subscription(member(), "active", "toss", start);
        UUID canceled = subscription(member(), "canceled", "toss", start);
        UUID pastDue = subscription(member(), "past_due", "toss", start);
        UUID expired = subscription(member(), "expired", "toss", start);
        UUID otherPeriod = subscription(member(), "active", "toss", start.plusSeconds(1));
        jdbc.update("UPDATE billing_subscriptions SET retry_count=2, next_retry_at=? WHERE id=?", at(now), pastDue);

        for (UUID id : List.of(active, canceled, pastDue, expired, otherPeriod)) {
            billing.advance(id, start, end, now.plusSeconds(1));
        }
        billing.advance(active, start, end.plus(Duration.ofDays(30)), now.plusSeconds(2));

        assertThat(state(active)).isEqualTo("active " + start + " " + end + " - 0 -");
        assertThat(state(canceled)).startsWith("canceled " + start + " " + end);
        assertThat(state(pastDue)).isEqualTo("active " + start + " " + end + " - 0 -");
        assertThat(state(expired)).startsWith("expired - " + start);
        assertThat(state(otherPeriod)).startsWith("active - " + start.plusSeconds(1));
    }

    @Test
    @DisplayName("markPastDue 는 active·past_due 만 past_due 로 바꾸고 재시도 칸을 적는다. expire 는 무조건 expired 로 바꾸고 카드 키·재시도 시각을 비운다. dropUnpaidKey 는 expired 이고 키가 있을 때만 키를 비운다")
    void pastDueExpireAndDropKey() {
        UUID active = subscription(member(), "active", "toss", now);
        UUID canceled = subscription(member(), "canceled", "toss", now);
        billing.markPastDue(active, 1, now.plusSeconds(3600), now.plusSeconds(1));
        billing.markPastDue(active, 2, now.plusSeconds(7200), now.plusSeconds(2));
        billing.markPastDue(canceled, 1, now.plusSeconds(3600), now.plusSeconds(1));
        assertThat(state(active)).isEqualTo("past_due - " + now + " - 2 " + now.plusSeconds(7200));
        assertThat(state(canceled)).startsWith("canceled");

        billing.expire(active, now.plusSeconds(3));
        billing.expire(active, now.plusSeconds(4));
        assertThat(state(active)).isEqualTo("expired - " + now + " - 2 -");
        assertThat(jdbc.queryForObject("SELECT billing_key FROM billing_subscriptions WHERE id=?", String.class, active)).isNull();
        assertThat(instant("SELECT updated_at FROM billing_subscriptions WHERE id=?", active)).isEqualTo(now.plusSeconds(4));

        UUID unpaid = subscription(member(), "expired", "toss", null);
        UUID paying = subscription(member(), "active", "toss", now);
        billing.dropUnpaidKey(unpaid, now.plusSeconds(5));
        billing.dropUnpaidKey(unpaid, now.plusSeconds(6));
        billing.dropUnpaidKey(paying, now.plusSeconds(5));
        assertThat(jdbc.queryForObject("SELECT billing_key FROM billing_subscriptions WHERE id=?", String.class, unpaid)).isNull();
        assertThat(instant("SELECT updated_at FROM billing_subscriptions WHERE id=?", unpaid))
                .as("키가 없으면 두 번째는 바꾸지 않는다").isEqualTo(now.plusSeconds(5));
        assertThat(jdbc.queryForObject("SELECT billing_key FROM billing_subscriptions WHERE id=?", String.class, paying))
                .isEqualTo("k1:key");
    }

    @Test
    @DisplayName("cancel 은 active 일 때만 canceled 로 바꾸고 true 다. 두 번째·active 가 아닌 구독은 false 이고 바꾸지 않는다. release 는 lease 를 비운다")
    void cancelOnlyOnceAndRelease() {
        UUID id = subscription(member(), "active", "toss", now);
        UUID pastDue = subscription(member(), "past_due", "toss", now);

        assertThat(billing.cancel(id, now.plusNanos(1_500))).isTrue();
        assertThat(billing.cancel(id, now.plusSeconds(9))).isFalse();
        assertThat(billing.cancel(pastDue, now)).isFalse();
        assertThat(billing.cancel(UUID.randomUUID(), now)).isFalse();
        assertThat(state(id)).isEqualTo("canceled - " + now + " " + now.plus(2, ChronoUnit.MICROS) + " 0 -");
        assertThat(state(pastDue)).startsWith("past_due");

        jdbc.update("UPDATE billing_subscriptions SET lease_until=? WHERE id=?", at(now), id);
        billing.release(id);
        billing.release(id);
        assertThat(jdbc.queryForObject("SELECT lease_until FROM billing_subscriptions WHERE id=?", OffsetDateTime.class, id)).isNull();
    }

    @Test
    @DisplayName("같은 구독을 두 요청이 함께 해지하면 뒤의 것이 앞의 커밋을 기다렸다가 false 다. 앞의 것이 되돌리면 뒤의 것이 해지한다")
    void twoCancelsOfTheSameSubscription() throws Exception {
        UUID id = subscription(member(), "active", "toss", now);
        Race<Boolean> first = holdOpen(() -> billing.cancel(id, now));
        try {
            Future<Boolean> later = first.pool.submit(() -> billing.cancel(id, now.plusSeconds(1)));
            assertThat(awaitStatementWaitingOn("billing_subscriptions")).startsWith("update billing_subscriptions");
            first.commit();
            assertThat(first.result()).isTrue();
            assertThat(later.get(20, TimeUnit.SECONDS)).isFalse();
        } finally {
            first.pool.shutdownNow();
        }

        UUID undone = subscription(member(), "active", "toss", now);
        Race<Boolean> rolledBack = holdOpen(() -> billing.cancel(undone, now));
        try {
            Future<Boolean> later = rolledBack.pool.submit(() -> billing.cancel(undone, now.plusSeconds(1)));
            awaitStatementWaitingOn("billing_subscriptions");
            rolledBack.rollback();
            assertThat(later.get(20, TimeUnit.SECONDS)).isTrue();
        } finally {
            rolledBack.pool.shutdownNow();
        }
    }

    @Test
    @DisplayName("갱신 결제 중에 해지가 먼저 커밋되면 advance 는 그 뒤에서 기다렸다가 기간을 넘기되 canceled 를 남긴다")
    void advanceAfterAConcurrentCancelKeepsTheCancel() throws Exception {
        UUID id = subscription(member(), "active", "toss", now);
        Instant end = now.plus(Duration.ofDays(30));
        Race<Boolean> cancel = holdOpen(() -> billing.cancel(id, now));
        try {
            Future<?> advance = cancel.pool.submit(() -> billing.advance(id, now, end, now.plusSeconds(1)));
            awaitStatementWaitingOn("billing_subscriptions");
            cancel.commit();
            advance.get(20, TimeUnit.SECONDS);
        } finally {
            cancel.pool.shutdownNow();
        }
        assertThat(state(id)).startsWith("canceled " + now + " " + end);
    }

    // ---- 결제 기록 ----

    @Test
    @DisplayName("insertPayment 는 모든 칸을 적고 true 다. 같은 주문 번호가 다시 오면 false 이고 있던 행을 건드리지 않는다")
    void insertPaymentIsOncePerOrder() {
        UUID user = member();
        UUID subscription = subscription(user, "active", "toss", now);
        Payment payment = payment(subscription, user, "order-1", "unknown", now, 1);

        assertThat(billing.insertPayment(payment)).isTrue();
        assertThat(billing.insertPayment(new Payment(UUID.randomUUID(), subscription, user, "order-1", "first", 1,
                "done", now, now, 9))).isFalse();

        assertThat(billing.findPayment("order-1")).contains(payment);
        assertThat(jdbc.queryForMap("SELECT check_count, approved_at, failure_code FROM billing_payments WHERE order_id='order-1'"))
                .containsEntry("check_count", 0).containsEntry("approved_at", null).containsEntry("failure_code", null);
        assertThat(billing.findPayment("order-none")).isEmpty();
    }

    @Test
    @DisplayName("같은 주문 번호를 두 요청이 함께 넣으면 뒤의 INSERT 가 앞의 커밋을 기다렸다가 false 다. 앞의 것이 되돌리면 뒤의 것이 넣는다")
    void twoInsertsOfTheSameOrder() throws Exception {
        UUID user = member();
        UUID subscription = subscription(user, "active", "toss", now);
        Race<Boolean> first = holdOpen(() -> billing.insertPayment(payment(subscription, user, "order-race", "unknown", now, 1)));
        try {
            Future<Boolean> later = first.pool.submit(() ->
                    billing.insertPayment(payment(subscription, user, "order-race", "unknown", now, 2)));
            assertThat(awaitStatementWaitingOn("billing_payments")).startsWith("insert into billing_payments");
            first.commit();
            assertThat(first.result()).isTrue();
            assertThat(later.get(20, TimeUnit.SECONDS)).isFalse();
        } finally {
            first.pool.shutdownNow();
        }

        Race<Boolean> rolledBack = holdOpen(() -> billing.insertPayment(payment(subscription, user, "order-undo", "unknown", now, 1)));
        try {
            Future<Boolean> later = rolledBack.pool.submit(() ->
                    billing.insertPayment(payment(subscription, user, "order-undo", "unknown", now, 2)));
            awaitStatementWaitingOn("billing_payments");
            rolledBack.rollback();
            assertThat(later.get(20, TimeUnit.SECONDS)).isTrue();
        } finally {
            rolledBack.pool.shutdownNow();
        }
        assertThat(jdbc.queryForList("SELECT order_id || ' ' || attempt FROM billing_payments ORDER BY order_id", String.class))
                .containsExactly("order-race 1", "order-undo 2");
    }

    @Test
    @DisplayName("hasUnresolvedPayment 는 done·failed 가 아닌 자기 결제가 있는가다. lastPayment 는 같은 기간 시작의 가장 큰 시도다")
    void unresolvedAndLastPayment() {
        UUID user = member();
        UUID subscription = subscription(user, "active", "toss", now);
        UUID other = member();
        UUID otherSubscription = subscription(other, "active", "toss", now);
        billing.insertPayment(payment(subscription, user, "o-1", "failed", now, 1));
        billing.insertPayment(payment(subscription, user, "o-2", "done", now, 3));
        billing.insertPayment(payment(subscription, user, "o-3", "failed", now, 2));
        billing.insertPayment(payment(subscription, user, "o-4", "failed", now.plusSeconds(1), 9));
        billing.insertPayment(payment(otherSubscription, other, "o-5", "unknown", now, 1));

        assertThat(billing.hasUnresolvedPayment(user)).isFalse();
        assertThat(billing.hasUnresolvedPayment(other)).isTrue();
        assertThat(billing.lastPayment(subscription, now)).map(Payment::orderId).contains("o-2");
        assertThat(billing.lastPayment(subscription, now.minusSeconds(1))).isEmpty();
    }

    @Test
    @DisplayName("finishPayment 는 done 이 아닌 결제만 상태·승인 시각·실패 코드·updated_at 을 바꾼다. done 뒤에 다시 와도 바꾸지 않는다")
    void finishPaymentNeverOverwritesDone() {
        UUID user = member();
        UUID subscription = subscription(user, "active", "toss", now);
        billing.insertPayment(payment(subscription, user, "order-f", "unknown", now, 1));

        billing.finishPayment("order-f", "failed", null, "REJECT", now.plusSeconds(1));
        billing.finishPayment("order-f", "done", "2026-11-25T12:00:01+09:00", null, now.plusSeconds(2));
        billing.finishPayment("order-f", "failed", null, "LATE", now.plusSeconds(3));

        assertThat(jdbc.queryForMap("SELECT status, approved_at, failure_code FROM billing_payments WHERE order_id='order-f'"))
                .containsEntry("status", "done").containsEntry("approved_at", "2026-11-25T12:00:01+09:00")
                .containsEntry("failure_code", null);
        assertThat(instant("SELECT updated_at FROM billing_payments WHERE order_id=?", "order-f")).isEqualTo(now.plusSeconds(2));
    }

    // ---- 스토어 ----

    @Test
    @DisplayName("expireStore 는 apple·google 의 expired 아닌 구독만 expired 로 바꾸고 해지 시각을 비우며 true 다. 두 번째·toss·없는 회원은 false 다")
    void expireStoreOnlyOnceAndOnlyForStores() {
        UUID apple = member();
        UUID appleId = subscription(apple, "canceled", "apple", now);
        jdbc.update("UPDATE billing_subscriptions SET canceled_at=? WHERE id=?", at(now), appleId);
        UUID toss = member();
        subscription(toss, "active", "toss", now);

        assertThat(billing.expireStore(apple, now.plusSeconds(1))).isTrue();
        assertThat(billing.expireStore(apple, now.plusSeconds(2))).isFalse();
        assertThat(billing.expireStore(toss, now)).isFalse();
        assertThat(billing.expireStore(member(), now)).isFalse();
        assertThat(state(appleId)).isEqualTo("expired - " + now + " - 0 -");
        assertThat(instant("SELECT updated_at FROM billing_subscriptions WHERE id=?", appleId)).isEqualTo(now.plusSeconds(1));
    }

    // ---- 문장 ----

    @Test
    @DisplayName("포트 메서드마다 나가는 문장의 수와 종류")
    void eachPortMethodSendsTheseStatements() {
        SoftAssertions soft = new SoftAssertions();
        UUID user = member();
        UUID id = billing.saveCard(user, "ck-s", "k1:s", "신한", "1", now);
        soft.assertThat(statementsOf(() -> billing.saveCard(user, "ck-s", "k1:s", "신한", "1", now)))
                .containsExactly("select users for update", "insert billing_subscriptions on conflict returning");
        soft.assertThat(statementsOf(() -> billing.find(user))).containsExactly("select billing_subscriptions");
        soft.assertThat(statementsOf(() -> billing.findById(id))).containsExactly("select billing_subscriptions");
        soft.assertThat(statementsOf(() -> billing.displayName(user))).containsExactly("select users");
        soft.assertThat(statementsOf(() -> billing.email(user))).containsExactly("select users");
        soft.assertThat(statementsOf(() -> billing.signedUpAt(user))).containsExactly("select users");
        soft.assertThat(statementsOf(() -> billing.termsV2PublishedAt())).containsExactly("select consent_documents");
        soft.assertThat(statementsOf(() -> billing.grantEnd(user, now))).containsExactly("select billing_pro_grants");
        Checkout checkout = checkout(user, "state-s", now.plusSeconds(600));
        soft.assertThat(statementsOf(() -> {
            billing.openCheckout(checkout);
            return null;
        })).containsExactly("insert billing_checkouts");
        soft.assertThat(statementsOf(() -> billing.findOpenCheckout("state-s", now))).containsExactly("select billing_checkouts");
        soft.assertThat(statementsOf(() -> billing.claimCheckout("state-s", now)))
                .containsExactly("update billing_checkouts returning");
        soft.assertThat(statementsOf(() -> billing.claimCheckout("state-s", now)))
                .as("집을 창이 없을 때").containsExactly("update billing_checkouts returning");
        soft.assertThat(statementsOf(() -> {
            billing.finishCheckout(checkout.id(), "done", null, now);
            return null;
        })).containsExactly("update billing_checkouts");
        soft.assertThat(statementsOf(() -> {
            billing.choosePlan(id, BillingRules.Plan.YEARLY, now);
            return null;
        })).containsExactly("update billing_subscriptions");
        soft.assertThat(statementsOf(() -> billing.activate(id, now, now.plusSeconds(60), now)))
                .containsExactly("select billing_subscriptions", "select users for update", "update billing_subscriptions");
        soft.assertThat(statementsOf(() -> {
            billing.advance(id, now.plusSeconds(60), now.plusSeconds(120), now);
            return null;
        })).containsExactly("update billing_subscriptions");
        soft.assertThat(statementsOf(() -> {
            billing.markPastDue(id, 1, now, now);
            return null;
        })).containsExactly("update billing_subscriptions");
        soft.assertThat(statementsOf(() -> billing.cancel(id, now))).containsExactly("update billing_subscriptions");
        soft.assertThat(statementsOf(() -> {
            billing.expire(id, now);
            return null;
        })).containsExactly("update billing_subscriptions");
        soft.assertThat(statementsOf(() -> {
            billing.dropUnpaidKey(id, now);
            return null;
        })).containsExactly("update billing_subscriptions");
        soft.assertThat(statementsOf(() -> billing.claimDue(now, Duration.ofMinutes(5))))
                .containsExactly("update billing_subscriptions for update of s skip locked returning");
        soft.assertThat(statementsOf(() -> {
            billing.release(id);
            return null;
        })).containsExactly("update billing_subscriptions");
        soft.assertThat(statementsOf(() -> billing.insertPayment(payment(id, user, "order-s", "unknown", now, 1))))
                .containsExactly("insert billing_payments on conflict");
        soft.assertThat(statementsOf(() -> billing.findPayment("order-s"))).containsExactly("select billing_payments");
        soft.assertThat(statementsOf(() -> billing.hasUnresolvedPayment(user))).containsExactly("select billing_payments");
        soft.assertThat(statementsOf(() -> billing.lastPayment(id, now))).containsExactly("select billing_payments");
        soft.assertThat(statementsOf(() -> {
            billing.finishPayment("order-s", "done", null, null, now);
            return null;
        })).containsExactly("update billing_payments");
        soft.assertThat(statementsOf(() -> billing.claimUnknownPayment(now, Duration.ofMinutes(5), 3)))
                .containsExactly("update billing_payments for update skip locked returning");
        soft.assertThat(statementsOf(() -> billing.saveStore(member(), new StoreState(BillingRules.PROVIDER_APPLE,
                "pro_monthly", "txn-s", BillingRules.Status.ACTIVE, now, now.plusSeconds(60), null), now)))
                .containsExactly("insert billing_subscriptions on conflict returning");
        soft.assertThat(statementsOf(() -> billing.expireStore(user, now))).containsExactly("update billing_subscriptions");
        soft.assertAll();
    }

    // ---- 도움 ----

    private static final Pattern INSERT = Pattern.compile("^insert into (\\w+)\\b.*");
    private static final Pattern UPDATE = Pattern.compile("^update (\\w+)\\b.*");
    private static final Pattern DELETE = Pattern.compile("^delete from (\\w+)\\b.*");
    private static final Pattern TABLE = Pattern.compile("^(\\w+)\\b.*");
    private static final Pattern LOCK = Pattern.compile(" for update( of \\w+)?( skip locked)?");

    /**
     * 문장을 "<종류> <표>[ 잠금][ on conflict][ returning]" 으로 줄인다. 별칭·열 목록·매개변수 표기는 두 구현이 달라 견주지 않는다.
     * SELECT 의 표는 괄호 밖 FROM 의 첫 표다.
     */
    static String label(String sql) {
        String text = sql.strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
        String conflict = text.contains(" on conflict") ? " on conflict" : "";
        String returning = text.contains(" returning ") ? " returning" : "";
        Matcher locked = LOCK.matcher(text);
        String lock = locked.find() ? locked.group() : "";
        Matcher matcher;
        if (text.startsWith("select ")) {
            return "select " + outerTable(text) + lock;
        }
        if ((matcher = INSERT.matcher(text)).matches()) {
            return "insert " + matcher.group(1) + conflict + returning;
        }
        if ((matcher = UPDATE.matcher(text)).matches()) {
            return "update " + matcher.group(1) + lock + returning;
        }
        if ((matcher = DELETE.matcher(text)).matches()) {
            return "delete " + matcher.group(1) + returning;
        }
        return text;
    }

    private static String outerTable(String text) {
        int depth = 0;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c == '(') {
                depth++;
            } else if (c == ')') {
                depth--;
            } else if (depth == 0 && text.startsWith(" from ", i)) {
                Matcher matcher = TABLE.matcher(text.substring(i + " from ".length()));
                return matcher.matches() ? matcher.group(1) : "(subquery)";
            }
        }
        return "(none)";
    }

    private List<String> statementsOf(Supplier<?> call) {
        Recorder.STATEMENTS.get().clear();
        call.get();
        List<String> sent = Recorder.STATEMENTS.get().stream().map(BillingRepositoryIT::label).toList();
        Recorder.STATEMENTS.get().clear();
        return sent;
    }

    /** 첫 요청: 트랜잭션 안에서 포트를 부르고, 커밋하거나 되돌릴 때까지 열어 둔다. */
    private final class Race<T> {
        final ExecutorService pool = Executors.newFixedThreadPool(2);
        private final CountDownLatch done = new CountDownLatch(1);
        private final CountDownLatch release = new CountDownLatch(1);
        private volatile boolean rollback;
        private final Future<T> result;

        Race(Supplier<T> call) {
            TransactionTemplate transaction = new TransactionTemplate(transactionManager);
            result = pool.submit(() -> transaction.execute((TransactionStatus tx) -> {
                T value = call.get();
                done.countDown();
                await(release);
                if (rollback) {
                    tx.setRollbackOnly();
                }
                return value;
            }));
            await(done);
        }

        void commit() {
            release.countDown();
        }

        void rollback() {
            rollback = true;
            release.countDown();
        }

        T result() throws Exception {
            return result.get(20, TimeUnit.SECONDS);
        }
    }

    private <T> Race<T> holdOpen(Supplier<T> call) {
        return new Race<>(call);
    }

    private UUID member() {
        UUID id = UUID.randomUUID();
        jdbc.update("INSERT INTO users(id,status,email) VALUES (?,'active',?)", id, id + "@example.test");
        return id;
    }

    /** 월 요금제 구독 하나. {@code periodEnd} 가 null 이면 기간이 없다. 카드 키는 {@code k1:key} 다. */
    private UUID subscription(UUID user, String status, String provider, Instant periodEnd) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO billing_subscriptions(id,user_id,status,provider,customer_key,billing_key,amount,current_period_end,
                    created_at,updated_at)
                VALUES (?,?,?,?,?,'k1:key',3900,?,?,?)
                """, id, user, status, provider, "ck-" + id, periodEnd == null ? null : at(periodEnd), at(now), at(now));
        return id;
    }

    private void grant(UUID user, Instant startsAt, Instant endsAt) {
        jdbc.update("INSERT INTO billing_pro_grants(id,user_id,starts_at,ends_at,reason) VALUES (?,?,?,?,'test')",
                UUID.randomUUID(), user, at(startsAt), at(endsAt));
    }

    private static Checkout checkout(UUID user, String stateHash, Instant expiresAt) {
        UUID id = UUID.randomUUID();
        return new Checkout(id, user, stateHash, BillingRules.Purpose.CHANGE_CARD, "ck-" + user, "order-" + id, expiresAt,
                BillingRules.Plan.YEARLY);
    }

    private static Payment payment(UUID subscription, UUID user, String orderId, String status, Instant periodStart,
            int attempt) {
        return new Payment(UUID.randomUUID(), subscription, user, orderId, "renewal", 3900, status, periodStart,
                periodStart.plus(Duration.ofDays(30)), attempt);
    }

    private String planAndAmount(UUID id) {
        return jdbc.queryForObject("SELECT plan || ' ' || amount FROM billing_subscriptions WHERE id=?", String.class, id);
    }

    /** "<상태> <기간 시작> <기간 끝> <해지 시각> <재시도 수> <다음 재시도>" — 비면 "-". */
    private String state(UUID id) {
        Map<String, Object> row = jdbc.queryForMap("""
                SELECT status, current_period_start AS s, current_period_end AS e, canceled_at AS c, retry_count AS r,
                       next_retry_at AS n
                FROM billing_subscriptions WHERE id=?
                """, id);
        return row.get("status") + " " + text(row.get("s")) + " " + text(row.get("e")) + " " + text(row.get("c")) + " "
                + row.get("r") + " " + text(row.get("n"));
    }

    private static String text(Object value) {
        if (value == null) {
            return "-";
        }
        if (value instanceof java.sql.Timestamp timestamp) {
            return timestamp.toInstant().toString();
        }
        if (value instanceof OffsetDateTime offset) {
            return offset.toInstant().toString();
        }
        return value.toString();
    }

    private Instant instant(String sql, Object... args) {
        return jdbc.queryForObject(sql, OffsetDateTime.class, args).toInstant();
    }

    private static OffsetDateTime at(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }

    private static void await(CountDownLatch latch) {
        try {
            assertThat(latch.await(20, TimeUnit.SECONDS)).isTrue();
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException(exc);
        }
    }

    /** 그 표를 쓰는 문장이 잠금을 기다리면 그 문장을 소문자로 낸다. */
    private String awaitStatementWaitingOn(String table) throws Exception {
        Instant deadline = Instant.now().plusSeconds(10);
        while (Instant.now().isBefore(deadline)) {
            List<String> waiting = jdbc.queryForList("""
                    SELECT query FROM pg_stat_activity
                    WHERE datname=current_database() AND wait_event_type='Lock'
                      AND query ILIKE ?
                    """, String.class, "%" + table + "%");
            if (!waiting.isEmpty()) {
                return waiting.getFirst().strip().replaceAll("\\s+", " ").toLowerCase(Locale.ROOT);
            }
            Thread.sleep(10);
        }
        throw new AssertionError("뒤의 요청이 앞의 잠금 뒤에서 기다리지 않았다");
    }
}
