package com.acttub.actingapi.feature.billing.adapter.db;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.billing.app.BillingRepository;
import com.acttub.actingapi.feature.billing.app.BillingRules;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** 앱 Pro 정기결제의 장부(V64, SOMA-818). 표 넷을 native SQL 로만 읽고 쓴다(엔티티 없음). */
@Repository
class PostgresBillingRepository implements BillingRepository {
    private static final String SUBSCRIPTION_COLUMNS = """
            id, user_id, status, customer_key, billing_key, card_company, card_number, amount,
            current_period_start, current_period_end, canceled_at, retry_count, next_retry_at, provider
            """;
    private static final String PAYMENT_COLUMNS = """
            id, subscription_id, user_id, order_id, kind, amount, status, period_start, period_end, attempt
            """;

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresBillingRepository(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Optional<Subscription> find(UUID userId) {
        return transaction.execute(tx -> first(NativeTuples.list(entityManager.createNativeQuery(
                "SELECT " + SUBSCRIPTION_COLUMNS + " FROM billing_subscriptions WHERE user_id=:userId", Tuple.class)
                .setParameter("userId", userId))).map(PostgresBillingRepository::subscription));
    }

    @Override
    public Optional<Subscription> findById(UUID subscriptionId) {
        return transaction.execute(tx -> first(NativeTuples.list(entityManager.createNativeQuery(
                "SELECT " + SUBSCRIPTION_COLUMNS + " FROM billing_subscriptions WHERE id=:id", Tuple.class)
                .setParameter("id", subscriptionId))).map(PostgresBillingRepository::subscription));
    }

    @Override
    public int coachingSessionsSince(UUID userId, Instant since) {
        return transaction.execute(tx -> ((Number) entityManager.createNativeQuery(
                "SELECT count(*) FROM practices WHERE user_id=:userId AND created_at>=CAST(:since AS timestamptz)")
                .setParameter("userId", userId)
                .setParameter("since", at(since))
                .getSingleResult()).intValue());
    }

    @Override
    public Optional<Instant> grantEnd(UUID userId, Instant now) {
        return transaction.execute(tx -> {
            Object end = entityManager.createNativeQuery(
                    "SELECT max(ends_at) FROM billing_pro_grants WHERE user_id=:userId "
                            + "AND starts_at<=CAST(:now AS timestamptz) AND ends_at>CAST(:now AS timestamptz)")
                    .setParameter("userId", userId)
                    .setParameter("now", at(now))
                    .getSingleResult();
            if (end == null) {
                return Optional.<Instant>empty();
            }
            if (end instanceof OffsetDateTime offset) {
                return Optional.of(offset.toInstant());
            }
            if (end instanceof Instant direct) {
                return Optional.of(direct);
            }
            return Optional.of(((java.sql.Timestamp) end).toInstant());
        });
    }

    @Override
    public int scriptCount(UUID userId) {
        return transaction.execute(tx -> ((Number) entityManager.createNativeQuery(
                "SELECT count(*) FROM scripts WHERE user_id=:userId")
                .setParameter("userId", userId)
                .getSingleResult()).intValue());
    }

    @Override
    public void openCheckout(Checkout checkout) {
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery("""
                INSERT INTO billing_checkouts(id,user_id,state_hash,purpose,customer_key,order_id,status,expires_at)
                VALUES (:id,:userId,:stateHash,:purpose,:customerKey,:orderId,'open',CAST(:expiresAt AS timestamptz))
                """)
                .setParameter("id", checkout.id())
                .setParameter("userId", checkout.userId())
                .setParameter("stateHash", checkout.stateHash())
                .setParameter("purpose", checkout.purpose().db())
                .setParameter("customerKey", checkout.customerKey())
                .setParameter("orderId", checkout.orderId())
                .setParameter("expiresAt", at(checkout.expiresAt()))
                .executeUpdate());
    }

    @Override
    public Optional<Checkout> claimCheckout(String stateHash, Instant now) {
        return transaction.execute(tx -> first(NativeTuples.list(entityManager.createNativeQuery("""
                UPDATE billing_checkouts SET status='processing', updated_at=CAST(:now AS timestamptz)
                WHERE state_hash=:stateHash AND status='open' AND expires_at > CAST(:now AS timestamptz)
                RETURNING id, user_id, state_hash, purpose, customer_key, order_id, expires_at
                """, Tuple.class)
                .setParameter("stateHash", stateHash)
                .setParameter("now", at(now)))).map(PostgresBillingRepository::checkout));
    }

    @Override
    public Optional<Checkout> findOpenCheckout(String stateHash, Instant now) {
        return transaction.execute(tx -> first(NativeTuples.list(entityManager.createNativeQuery("""
                SELECT id, user_id, state_hash, purpose, customer_key, order_id, expires_at FROM billing_checkouts
                WHERE state_hash=:stateHash AND status='open' AND expires_at > CAST(:now AS timestamptz)
                """, Tuple.class)
                .setParameter("stateHash", stateHash)
                .setParameter("now", at(now)))).map(PostgresBillingRepository::checkout));
    }

    @Override
    public void finishCheckout(UUID checkoutId, String status, String resultCode, Instant now) {
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery("""
                UPDATE billing_checkouts SET status=:status, result_code=:code, updated_at=CAST(:now AS timestamptz)
                WHERE id=:id
                """)
                .setParameter("status", status)
                .setParameter("code", resultCode)
                .setParameter("now", at(now))
                .setParameter("id", checkoutId)
                .executeUpdate());
    }

    @Override
    public UUID saveCard(UUID userId, String customerKey, String sealedBillingKey, String cardCompany,
            String cardNumber, Instant now) {
        return transaction.execute(tx -> NativeTuples.list(entityManager.createNativeQuery("""
                INSERT INTO billing_subscriptions(id,user_id,status,provider,customer_key,billing_key,card_company,card_number,amount,
                                                  created_at,updated_at)
                VALUES (:id,:userId,'expired','toss',:customerKey,:billingKey,:company,:number,:amount,
                        CAST(:now AS timestamptz),CAST(:now AS timestamptz))
                ON CONFLICT (user_id) DO UPDATE SET provider='toss', store_product_id=NULL, store_original_transaction_id=NULL,
                    store_purchase_token=NULL, billing_key=EXCLUDED.billing_key, card_company=EXCLUDED.card_company,
                    card_number=EXCLUDED.card_number, customer_key=EXCLUDED.customer_key, updated_at=EXCLUDED.updated_at
                RETURNING id
                """, Tuple.class)
                .setParameter("id", UUID.randomUUID())
                .setParameter("userId", userId)
                .setParameter("customerKey", customerKey)
                .setParameter("billingKey", sealedBillingKey)
                .setParameter("company", cardCompany)
                .setParameter("number", cardNumber)
                .setParameter("amount", (int) BillingRules.AMOUNT)
                .setParameter("now", at(now))).get(0).get("id", UUID.class));
    }

    @Override
    public void activate(UUID subscriptionId, Instant periodStart, Instant periodEnd, Instant now) {
        update("""
                UPDATE billing_subscriptions SET status='active', current_period_start=CAST(:start AS timestamptz),
                    current_period_end=CAST(:end AS timestamptz), canceled_at=NULL, retry_count=0, next_retry_at=NULL,
                    updated_at=CAST(:now AS timestamptz)
                WHERE id=:id
                """, subscriptionId, periodStart, periodEnd, now);
    }

    @Override
    public void advance(UUID subscriptionId, Instant periodStart, Instant periodEnd, Instant now) {
        // 결제하는 동안 해지했으면 해지는 남는다(이번에 낸 기간이 끝날 때까지 Pro). 기간은 같은 시작에서만 넘긴다.
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery("""
                UPDATE billing_subscriptions
                SET status=CASE WHEN status='canceled' THEN 'canceled' ELSE 'active' END,
                    current_period_start=CAST(:start AS timestamptz), current_period_end=CAST(:end AS timestamptz),
                    retry_count=0, next_retry_at=NULL, updated_at=CAST(:now AS timestamptz)
                WHERE id=:id AND status IN ('active','canceled','past_due') AND current_period_end=CAST(:start AS timestamptz)
                """)
                .setParameter("start", at(periodStart))
                .setParameter("end", at(periodEnd))
                .setParameter("now", at(now))
                .setParameter("id", subscriptionId)
                .executeUpdate());
    }

    @Override
    public void markPastDue(UUID subscriptionId, int retryCount, Instant nextRetryAt, Instant now) {
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery("""
                UPDATE billing_subscriptions SET status='past_due', retry_count=:retry,
                    next_retry_at=CAST(:next AS timestamptz), updated_at=CAST(:now AS timestamptz)
                WHERE id=:id AND status IN ('active','past_due')
                """)
                .setParameter("retry", retryCount)
                .setParameter("next", at(nextRetryAt))
                .setParameter("now", at(now))
                .setParameter("id", subscriptionId)
                .executeUpdate());
    }

    @Override
    public void expire(UUID subscriptionId, Instant now) {
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery("""
                UPDATE billing_subscriptions SET status='expired', billing_key=NULL, next_retry_at=NULL,
                    updated_at=CAST(:now AS timestamptz)
                WHERE id=:id
                """)
                .setParameter("now", at(now))
                .setParameter("id", subscriptionId)
                .executeUpdate());
    }

    @Override
    public boolean cancel(UUID subscriptionId, Instant now) {
        Integer updated = transaction.execute(tx -> entityManager.createNativeQuery("""
                UPDATE billing_subscriptions SET status='canceled', canceled_at=CAST(:now AS timestamptz),
                    updated_at=CAST(:now AS timestamptz)
                WHERE id=:id AND status='active'
                """)
                .setParameter("now", at(now))
                .setParameter("id", subscriptionId)
                .executeUpdate());
        return updated != null && updated == 1;
    }

    @Override
    public Optional<UUID> claimDue(Instant now, Duration lease) {
        return transaction.execute(tx -> first(NativeTuples.list(entityManager.createNativeQuery("""
                UPDATE billing_subscriptions SET lease_until=CAST(:until AS timestamptz)
                WHERE id = (
                    SELECT s.id FROM billing_subscriptions s
                    WHERE s.provider='toss'
                      AND ((s.status IN ('active','canceled') AND s.current_period_end <= CAST(:now AS timestamptz))
                           OR (s.status='past_due' AND s.next_retry_at <= CAST(:now AS timestamptz))))
                      AND (s.lease_until IS NULL OR s.lease_until < CAST(:now AS timestamptz))
                      -- 결과를 모르는 결제가 있으면 그 결제를 먼저 확인한다(같은 키로 다시 묻는 쪽이 맡는다).
                      AND NOT EXISTS (SELECT 1 FROM billing_payments p
                                      WHERE p.subscription_id=s.id AND p.status IN ('pending','unknown'))
                    ORDER BY s.current_period_end
                    LIMIT 1
                    FOR UPDATE OF s SKIP LOCKED)
                RETURNING id
                """, Tuple.class)
                .setParameter("until", at(now.plus(lease)))
                .setParameter("now", at(now)))).map(row -> row.get("id", UUID.class)));
    }

    @Override
    public void release(UUID subscriptionId) {
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery(
                "UPDATE billing_subscriptions SET lease_until=NULL WHERE id=:id")
                .setParameter("id", subscriptionId)
                .executeUpdate());
    }

    @Override
    public boolean insertPayment(Payment payment) {
        Integer inserted = transaction.execute(tx -> entityManager.createNativeQuery("""
                INSERT INTO billing_payments(id,subscription_id,user_id,order_id,kind,amount,status,period_start,period_end,attempt)
                VALUES (:id,:subscriptionId,:userId,:orderId,:kind,:amount,:status,CAST(:start AS timestamptz),
                        CAST(:end AS timestamptz),:attempt)
                ON CONFLICT (order_id) DO NOTHING
                """)
                .setParameter("id", payment.id())
                .setParameter("subscriptionId", payment.subscriptionId())
                .setParameter("userId", payment.userId())
                .setParameter("orderId", payment.orderId())
                .setParameter("kind", payment.kind())
                .setParameter("amount", (int) payment.amount())
                .setParameter("status", payment.status())
                .setParameter("start", at(payment.periodStart()))
                .setParameter("end", at(payment.periodEnd()))
                .setParameter("attempt", payment.attempt())
                .executeUpdate());
        return inserted != null && inserted == 1;
    }

    @Override
    public Optional<Payment> findPayment(String orderId) {
        return transaction.execute(tx -> first(NativeTuples.list(entityManager.createNativeQuery(
                "SELECT " + PAYMENT_COLUMNS + " FROM billing_payments WHERE order_id=:orderId", Tuple.class)
                .setParameter("orderId", orderId))).map(PostgresBillingRepository::payment));
    }

    @Override
    public boolean hasUnresolvedPayment(UUID userId) {
        return transaction.execute(tx -> ((Number) entityManager.createNativeQuery(
                "SELECT count(*) FROM billing_payments WHERE user_id=:userId AND status IN ('pending','unknown')")
                .setParameter("userId", userId)
                .getSingleResult()).intValue() > 0);
    }

    @Override
    public Optional<Payment> lastPayment(UUID subscriptionId, Instant periodStart) {
        return transaction.execute(tx -> first(NativeTuples.list(entityManager.createNativeQuery(
                "SELECT " + PAYMENT_COLUMNS + """
                 FROM billing_payments WHERE subscription_id=:id AND period_start=CAST(:start AS timestamptz)
                 ORDER BY attempt DESC LIMIT 1
                """, Tuple.class)
                .setParameter("id", subscriptionId)
                .setParameter("start", at(periodStart)))).map(PostgresBillingRepository::payment));
    }

    @Override
    public void finishPayment(String orderId, String status, String approvedAt, String failureCode, Instant now) {
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery("""
                UPDATE billing_payments SET status=:status, approved_at=:approvedAt, failure_code=:code,
                    updated_at=CAST(:now AS timestamptz)
                WHERE order_id=:orderId AND status <> 'done'
                """)
                .setParameter("status", status)
                .setParameter("approvedAt", approvedAt)
                .setParameter("code", failureCode)
                .setParameter("now", at(now))
                .setParameter("orderId", orderId)
                .executeUpdate());
    }

    @Override
    public Optional<Payment> claimUnknownPayment(Instant now, Duration quietFor, int maxChecks) {
        return transaction.execute(tx -> first(NativeTuples.list(entityManager.createNativeQuery("""
                UPDATE billing_payments SET check_count=check_count+1, updated_at=CAST(:now AS timestamptz)
                WHERE id = (
                    SELECT id FROM billing_payments
                    WHERE status IN ('unknown','pending') AND updated_at < CAST(:quiet AS timestamptz)
                      AND check_count < :maxChecks
                    ORDER BY updated_at
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED)
                RETURNING
                """ + PAYMENT_COLUMNS, Tuple.class)
                .setParameter("now", at(now))
                .setParameter("quiet", at(now.minus(quietFor)))
                .setParameter("maxChecks", maxChecks))).map(PostgresBillingRepository::payment));
    }

    private void update(String sql, UUID id, Instant start, Instant end, Instant now) {
        transaction.executeWithoutResult(tx -> entityManager.createNativeQuery(sql)
                .setParameter("start", at(start))
                .setParameter("end", at(end))
                .setParameter("now", at(now))
                .setParameter("id", id)
                .executeUpdate());
    }

    private static <T> Optional<T> first(List<T> rows) {
        return rows.isEmpty() ? Optional.empty() : Optional.of(rows.get(0));
    }

    private static OffsetDateTime at(Instant instant) {
        return instant == null ? null : instant.atOffset(ZoneOffset.UTC);
    }

    private static Instant instant(Tuple row, String column) {
        Object value = row.get(column);
        if (value == null) {
            return null;
        }
        if (value instanceof OffsetDateTime offset) {
            return offset.toInstant();
        }
        if (value instanceof Instant direct) {
            return direct;
        }
        if (value instanceof java.sql.Timestamp timestamp) {
            return timestamp.toInstant();
        }
        throw new IllegalStateException("unexpected timestamp type for " + column);
    }

    // ── 스토어 구독(apple·google) ───────────────────────────────────

    private static String keyColumn(String provider) {
        return switch (provider) {
            case BillingRules.PROVIDER_APPLE -> "store_original_transaction_id";
            case BillingRules.PROVIDER_GOOGLE -> "store_purchase_token";
            default -> throw new IllegalArgumentException("not a store provider");
        };
    }

    @Override
    public Optional<StoreRow> findStore(String provider, String key) {
        String column = keyColumn(provider);
        return transaction.execute(tx -> first(NativeTuples.list(entityManager.createNativeQuery(
                "SELECT id, user_id, provider, status, current_period_end, updated_at FROM billing_subscriptions "
                        + "WHERE provider=:provider AND " + column + "=:key", Tuple.class)
                .setParameter("provider", provider)
                .setParameter("key", key))).map(row -> new StoreRow(
                        row.get("id", UUID.class),
                        row.get("user_id", UUID.class),
                        row.get("provider", String.class),
                        BillingRules.Status.of(row.get("status", String.class)),
                        instant(row, "current_period_end"),
                        instant(row, "updated_at"))));
    }

    /** 값이 없을 때 null 을 바인딩하면 드라이버가 타입을 못 정하므로 SQL 자리에 NULL 을 바로 쓴다. */
    private static String timestampOrNull(String name, Instant value) {
        return value == null ? "NULL" : "CAST(:" + name + " AS timestamptz)";
    }

    private static void bindTimestamp(jakarta.persistence.Query query, String name, Instant value) {
        if (value != null) {
            query.setParameter(name, at(value));
        }
    }

    @Override
    public StoreSave saveStore(UUID userId, StoreState state, Instant now) {
        boolean apple = BillingRules.PROVIDER_APPLE.equals(state.provider());
        keyColumn(state.provider());
        String sql = """
                INSERT INTO billing_subscriptions(id,user_id,status,provider,store_product_id,store_original_transaction_id,
                    store_purchase_token,amount,current_period_start,current_period_end,canceled_at,created_at,updated_at)
                VALUES (:id,:userId,:status,:provider,:product,%s,%s,:amount,%s,%s,%s,
                    CAST(:now AS timestamptz),CAST(:now AS timestamptz))
                ON CONFLICT (user_id) DO UPDATE SET status=EXCLUDED.status, provider=EXCLUDED.provider,
                    store_product_id=EXCLUDED.store_product_id,
                    store_original_transaction_id=EXCLUDED.store_original_transaction_id,
                    store_purchase_token=EXCLUDED.store_purchase_token, customer_key=NULL, billing_key=NULL,
                    card_company=NULL, card_number=NULL, amount=EXCLUDED.amount,
                    current_period_start=EXCLUDED.current_period_start, current_period_end=EXCLUDED.current_period_end,
                    canceled_at=EXCLUDED.canceled_at, retry_count=0, next_retry_at=NULL, lease_until=NULL,
                    updated_at=EXCLUDED.updated_at
                WHERE billing_subscriptions.provider<>'toss' OR billing_subscriptions.status='expired'
                RETURNING id
                """.formatted(apple ? ":key" : "NULL", apple ? "NULL" : ":key",
                timestampOrNull("start", state.periodStart()), timestampOrNull("end", state.periodEnd()),
                timestampOrNull("canceled", state.canceledAt()));
        List<Tuple> saved;
        try {
            saved = transaction.execute(tx -> {
                jakarta.persistence.Query query = entityManager.createNativeQuery(sql, Tuple.class)
                        .setParameter("id", UUID.randomUUID())
                        .setParameter("userId", userId)
                        .setParameter("status", state.status().db())
                        .setParameter("provider", state.provider())
                        .setParameter("product", state.productId())
                        .setParameter("key", state.key())
                        .setParameter("amount", (int) BillingRules.AMOUNT)
                        .setParameter("now", at(now));
                bindTimestamp(query, "start", state.periodStart());
                bindTimestamp(query, "end", state.periodEnd());
                bindTimestamp(query, "canceled", state.canceledAt());
                return NativeTuples.list(query);
            });
        } catch (RuntimeException failure) {
            for (Throwable cause = failure; cause != null; cause = cause.getCause()) {
                if (cause.getMessage() != null && cause.getMessage().contains("uq_billing_subscriptions_")) {
                    return StoreSave.TAKEN;
                }
            }
            throw failure;
        }
        return saved.isEmpty() ? StoreSave.BLOCKED : StoreSave.SAVED;
    }

    @Override
    public boolean updateStore(String provider, String key, StoreState state, Instant now) {
        String column = keyColumn(provider);
        String start = state.periodStart() == null ? "current_period_start" : "CAST(:start AS timestamptz)";
        String canceled = state.canceledAt() == null ? "" : "CAST(:canceled AS timestamptz), ";
        String sql = "UPDATE billing_subscriptions SET status=:status, current_period_start=" + start
                + ", current_period_end=" + timestampOrNull("end", state.periodEnd())
                + ", canceled_at=CASE WHEN CAST(:status AS text)='canceled' THEN COALESCE(canceled_at, " + canceled
                + "CAST(:now AS timestamptz)) ELSE NULL END, retry_count=0, next_retry_at=NULL, "
                + "updated_at=CAST(:now AS timestamptz) WHERE provider=:provider AND " + column + "=:key";
        return transaction.execute(tx -> {
            jakarta.persistence.Query query = entityManager.createNativeQuery(sql)
                    .setParameter("status", state.status().db())
                    .setParameter("now", at(now))
                    .setParameter("provider", provider)
                    .setParameter("key", key);
            bindTimestamp(query, "start", state.periodStart());
            bindTimestamp(query, "end", state.periodEnd());
            bindTimestamp(query, "canceled", state.canceledAt());
            return query.executeUpdate();
        }) > 0;
    }

    private static Subscription subscription(Tuple row) {
        return new Subscription(
                row.get("id", UUID.class),
                row.get("user_id", UUID.class),
                BillingRules.Status.of(row.get("status", String.class)),
                row.get("customer_key", String.class),
                row.get("billing_key", String.class),
                row.get("card_company", String.class),
                row.get("card_number", String.class),
                ((Number) row.get("amount")).longValue(),
                instant(row, "current_period_start"),
                instant(row, "current_period_end"),
                instant(row, "canceled_at"),
                ((Number) row.get("retry_count")).intValue(),
                instant(row, "next_retry_at"),
                row.get("provider", String.class));
    }

    private static Checkout checkout(Tuple row) {
        return new Checkout(
                row.get("id", UUID.class),
                row.get("user_id", UUID.class),
                row.get("state_hash", String.class),
                BillingRules.Purpose.of(row.get("purpose", String.class)),
                row.get("customer_key", String.class),
                row.get("order_id", String.class),
                instant(row, "expires_at"));
    }

    private static Payment payment(Tuple row) {
        return new Payment(
                row.get("id", UUID.class),
                row.get("subscription_id", UUID.class),
                row.get("user_id", UUID.class),
                row.get("order_id", String.class),
                row.get("kind", String.class),
                ((Number) row.get("amount")).longValue(),
                row.get("status", String.class),
                instant(row, "period_start"),
                instant(row, "period_end"),
                ((Number) row.get("attempt")).intValue());
    }
}
