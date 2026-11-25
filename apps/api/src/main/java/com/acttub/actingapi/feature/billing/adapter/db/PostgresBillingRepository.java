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
import com.acttub.actingapi.feature.billing.schema.BillingCheckoutEntity;
import com.acttub.actingapi.feature.billing.schema.BillingPaymentEntity;
import com.acttub.actingapi.feature.billing.schema.BillingSubscriptionEntity;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 앱 Pro 정기결제의 장부(V64, SOMA-818). 자기 표 넷(구독·카드 등록 창·결제·Pro 부여)은 Spring Data·JPQL·HQL 로 읽고 쓴다. 상태를
 * 바꾸는 조건부 갱신은 모두 한 문장이다.
 *
 * <p>native SQL 로 남은 것: 다른 기능의 표({@code users}·{@code user_profiles}·{@code consent_documents})를 읽거나 잠그는 문장,
 * 갱신할 구독과 확인할 결제를 {@code SKIP LOCKED} 로 집으며 고치는 점유 문장 둘(HQL 은 서브쿼리 안에서 잠그지 못해 읽고 쓰는 두
 * 문장이 된다), 활성 계정만 넣는 스토어 구독 upsert({@code insert … select … on conflict do update}, HQL 이 풀지 못한다)
 * (apps/api/CONTRACT.md §5-9).
 */
@Repository
class PostgresBillingRepository implements BillingRepository {
    private static final String PAYMENT_COLUMNS = """
            id, subscription_id, user_id, order_id, kind, amount, status, period_start, period_end, attempt
            """;

    private final EntityManager entityManager;
    private final BillingSubscriptionJpaRepository subscriptions;
    private final BillingCheckoutJpaRepository checkouts;
    private final BillingPaymentJpaRepository payments;
    private final BillingProGrantJpaRepository grants;
    private final TransactionTemplate transaction;

    PostgresBillingRepository(EntityManager entityManager, BillingSubscriptionJpaRepository subscriptions,
            BillingCheckoutJpaRepository checkouts, BillingPaymentJpaRepository payments, BillingProGrantJpaRepository grants,
            PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.subscriptions = subscriptions;
        this.checkouts = checkouts;
        this.payments = payments;
        this.grants = grants;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public Optional<Subscription> find(UUID userId) {
        return transaction.execute(tx -> subscriptions.findByUserId(userId).map(PostgresBillingRepository::subscription));
    }

    @Override
    public Optional<Subscription> findById(UUID subscriptionId) {
        return transaction.execute(tx -> subscriptions.findById(subscriptionId).map(PostgresBillingRepository::subscription));
    }

    @Override
    public Optional<String> displayName(UUID userId) {
        return transaction.execute(tx -> {
            var rows = entityManager.createNativeQuery("""
                    SELECT COALESCE(NULLIF(btrim(p.name), ''), NULLIF(btrim(u.nickname), ''))
                    FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
                    WHERE u.id = :userId
                    """)
                    .setParameter("userId", userId)
                    .getResultList();
            if (rows.isEmpty() || rows.get(0) == null || rows.get(0).toString().isBlank()) {
                return Optional.<String>empty();
            }
            return Optional.of(rows.get(0).toString().strip());
        });
    }

    @Override
    public Optional<String> email(UUID userId) {
        return transaction.execute(tx -> {
            var rows = entityManager.createNativeQuery("SELECT email FROM users WHERE id=:userId")
                    .setParameter("userId", userId)
                    .getResultList();
            if (rows.isEmpty() || rows.get(0) == null) {
                return Optional.<String>empty();
            }
            return Optional.of(rows.get(0).toString());
        });
    }

    @Override
    public Optional<Instant> signedUpAt(UUID userId) {
        return transaction.execute(tx -> {
            var rows = entityManager.createNativeQuery("SELECT created_at FROM users WHERE id=:userId")
                    .setParameter("userId", userId)
                    .getResultList();
            if (rows.isEmpty() || rows.get(0) == null) {
                return Optional.<Instant>empty();
            }
            Object value = rows.get(0);
            if (value instanceof OffsetDateTime offset) {
                return Optional.of(offset.toInstant());
            }
            if (value instanceof Instant direct) {
                return Optional.of(direct);
            }
            return Optional.of(((java.sql.Timestamp) value).toInstant());
        });
    }

    @Override
    public Optional<Instant> termsV2PublishedAt() {
        return transaction.execute(tx -> {
            var rows = entityManager.createNativeQuery(
                    // 유료 조항이 처음 실린 약관(v2)의 발행 시각. 운영 DB에는 v2 행이 있다. manifest 가 v3 이후를 가리키는 빈 DB
                    // (테스트·새 환경)에는 v2 행이 없으므로, v1 이 아닌 판 가운데 가장 먼저 발행된 것을 쓴다.
                    "SELECT min(published_at) FROM consent_documents WHERE type='terms' AND version <> 'v1' AND locale='ko'")
                    .getResultList();
            if (rows.isEmpty() || rows.get(0) == null) {
                return Optional.<Instant>empty();
            }
            Object value = rows.get(0);
            if (value instanceof OffsetDateTime offset) {
                return Optional.of(offset.toInstant());
            }
            if (value instanceof Instant direct) {
                return Optional.of(direct);
            }
            return Optional.of(((java.sql.Timestamp) value).toInstant());
        });
    }

    @Override
    public Optional<Instant> grantEnd(UUID userId, Instant now) {
        return transaction.execute(tx -> Optional.ofNullable(grants.latestEnd(userId, now)));
    }

    @Override
    public void openCheckout(Checkout checkout) {
        transaction.executeWithoutResult(tx -> checkouts.open(checkout.id(), checkout.userId(), checkout.stateHash(),
                checkout.purpose().db(), checkout.customerKey(), checkout.orderId(), checkout.expiresAt(), checkout.plan().db()));
    }

    /** 조건부 갱신은 한 문장이고, 집었으면(1행) 같은 트랜잭션에서 그 창을 다시 읽는다 — 이 트랜잭션이 그 행을 잡고 있다. */
    @Override
    public Optional<Checkout> claimCheckout(String stateHash, Instant now) {
        return transaction.execute(tx -> checkouts.claim(stateHash, now) == 0
                ? Optional.<Checkout>empty()
                : checkouts.findByStateHash(stateHash).map(PostgresBillingRepository::checkout));
    }

    @Override
    public Optional<Checkout> findOpenCheckout(String stateHash, Instant now) {
        return transaction.execute(tx -> checkouts.findOpen(stateHash, now).map(PostgresBillingRepository::checkout));
    }

    @Override
    public void finishCheckout(UUID checkoutId, String status, String resultCode, Instant now) {
        transaction.executeWithoutResult(tx -> checkouts.finish(checkoutId, status, resultCode, now));
    }

    @Override
    public UUID saveCard(UUID userId, String customerKey, String sealedBillingKey, String cardCompany,
            String cardNumber, Instant now) {
        return transaction.execute(tx -> {
            if (!lockActiveUser(userId)) {
                return null;
            }
            // upsert 는 한 문장이고, RETURNING 대신 같은 트랜잭션에서 회원의 한 행을 다시 읽는다.
            subscriptions.saveCard(UUID.randomUUID(), userId, customerKey, sealedBillingKey, cardCompany, cardNumber,
                    (int) BillingRules.AMOUNT, now);
            return subscriptions.idOf(userId).orElseThrow();
        });
    }

    @Override
    public void choosePlan(UUID subscriptionId, BillingRules.Plan plan, Instant now) {
        transaction.executeWithoutResult(tx -> subscriptions.choosePlan(subscriptionId, plan.db(), (int) plan.amount(), now));
    }

    @Override
    public boolean activate(UUID subscriptionId, Instant periodStart, Instant periodEnd, Instant now) {
        return transaction.execute(tx -> {
            UUID userId = subscriptions.userIdOf(subscriptionId)
                    .orElseThrow(() -> new EmptyResultDataAccessException(1));
            if (!lockActiveUser(userId)) {
                return false;
            }
            subscriptions.activate(subscriptionId, periodStart, periodEnd, now);
            return true;
        });
    }

    /** 탈퇴와 같은 users 행을 잡고 아직 활성인지 본다 — 탈퇴가 먼저 끝났으면 쓰지 않는다(CONTRACT 32, common 「탈퇴와 겹친 쓰기」). */
    private boolean lockActiveUser(UUID userId) {
        List<Tuple> rows = NativeTuples.list(entityManager.createNativeQuery(
                        "SELECT status FROM users WHERE id=:userId FOR UPDATE", Tuple.class)
                .setParameter("userId", userId));
        return !rows.isEmpty() && "active".equals(rows.getFirst().get("status", String.class));
    }

    @Override
    public void advance(UUID subscriptionId, Instant periodStart, Instant periodEnd, Instant now) {
        transaction.executeWithoutResult(tx -> subscriptions.advance(subscriptionId, periodStart, periodEnd, now));
    }

    @Override
    public void markPastDue(UUID subscriptionId, int retryCount, Instant nextRetryAt, Instant now) {
        transaction.executeWithoutResult(tx -> subscriptions.markPastDue(subscriptionId, retryCount, nextRetryAt, now));
    }

    @Override
    public void expire(UUID subscriptionId, Instant now) {
        transaction.executeWithoutResult(tx -> subscriptions.expire(subscriptionId, now));
    }

    @Override
    public void dropUnpaidKey(UUID subscriptionId, Instant now) {
        transaction.executeWithoutResult(tx -> subscriptions.dropUnpaidKey(subscriptionId, now));
    }

    @Override
    public boolean cancel(UUID subscriptionId, Instant now) {
        Integer updated = transaction.execute(tx -> subscriptions.cancel(subscriptionId, now));
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
                           OR (s.status='past_due' AND s.next_retry_at <= CAST(:now AS timestamptz)))
                      AND (s.lease_until IS NULL OR s.lease_until < CAST(:now AS timestamptz))
                      -- 결과를 모르는 결제가 있으면 그 결제를 먼저 확인한다(같은 키로 다시 묻는 쪽이 맡는다).
                      AND NOT EXISTS (SELECT 1 FROM billing_payments p
                                      WHERE p.subscription_id=s.id AND p.status NOT IN ('done','failed'))
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
        transaction.executeWithoutResult(tx -> subscriptions.release(subscriptionId));
    }

    @Override
    public boolean insertPayment(Payment payment) {
        Integer inserted = transaction.execute(tx -> payments.insert(payment.id(), payment.subscriptionId(), payment.userId(),
                payment.orderId(), payment.kind(), (int) payment.amount(), payment.status(), payment.periodStart(),
                payment.periodEnd(), payment.attempt()));
        return inserted != null && inserted == 1;
    }

    @Override
    public Optional<Payment> findPayment(String orderId) {
        return transaction.execute(tx -> payments.findByOrderId(orderId).map(PostgresBillingRepository::payment));
    }

    @Override
    public boolean hasUnresolvedPayment(UUID userId) {
        return transaction.execute(tx -> payments.countUnresolved(userId) > 0);
    }

    @Override
    public Optional<Payment> lastPayment(UUID subscriptionId, Instant periodStart) {
        return transaction.execute(tx -> payments.findFirstBySubscriptionIdAndPeriodStartOrderByAttemptDesc(subscriptionId,
                periodStart).map(PostgresBillingRepository::payment));
    }

    @Override
    public void finishPayment(String orderId, String status, String approvedAt, String failureCode, Instant now) {
        transaction.executeWithoutResult(tx -> payments.finish(orderId, status, approvedAt, failureCode, now));
    }

    @Override
    public Optional<Payment> claimUnknownPayment(Instant now, Duration quietFor, int maxChecks) {
        return transaction.execute(tx -> first(NativeTuples.list(entityManager.createNativeQuery("""
                UPDATE billing_payments SET check_count=check_count+1, updated_at=CAST(:now AS timestamptz)
                WHERE id = (
                    SELECT id FROM billing_payments
                    WHERE status NOT IN ('done','failed') AND updated_at < CAST(:quiet AS timestamptz)
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

    // ── 스토어 구독(apple·google, RevenueCat) ──────────────────────

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
        if (!BillingRules.PROVIDER_APPLE.equals(state.provider()) && !BillingRules.PROVIDER_GOOGLE.equals(state.provider())) {
            throw new IllegalArgumentException("not a store provider");
        }
        // 활성 사용자일 때만 넣는다(탈퇴한 사람의 늦은 웹훅이 줄을 되살리지 않게). 토스로 이용 중인 줄은 WHERE 가 막는다.
        String sql = """
                INSERT INTO billing_subscriptions(id,user_id,status,provider,plan,store_product_id,store_transaction_id,amount,
                    current_period_start,current_period_end,canceled_at,created_at,updated_at)
                SELECT :id,:userId,:status,:provider,:plan,:product,%s,:amount,%s,%s,%s,CAST(:now AS timestamptz),CAST(:now AS timestamptz)
                WHERE EXISTS (SELECT 1 FROM users WHERE id=:userId AND status='active')
                ON CONFLICT (user_id) DO UPDATE SET status=EXCLUDED.status, provider=EXCLUDED.provider, plan=EXCLUDED.plan,
                    store_product_id=EXCLUDED.store_product_id, store_transaction_id=EXCLUDED.store_transaction_id,
                    customer_key=NULL, billing_key=NULL, card_company=NULL, card_number=NULL, amount=EXCLUDED.amount,
                    current_period_start=EXCLUDED.current_period_start, current_period_end=EXCLUDED.current_period_end,
                    canceled_at=EXCLUDED.canceled_at, retry_count=0, next_retry_at=NULL, lease_until=NULL,
                    updated_at=EXCLUDED.updated_at
                WHERE billing_subscriptions.provider<>'toss' OR billing_subscriptions.status='expired'
                RETURNING id
                """.formatted(state.storeTransactionId() == null ? "NULL" : ":txn",
                timestampOrNull("start", state.periodStart()), timestampOrNull("end", state.periodEnd()),
                timestampOrNull("canceled", state.canceledAt()));
        List<Tuple> saved = transaction.execute(tx -> {
            jakarta.persistence.Query query = entityManager.createNativeQuery(sql, Tuple.class)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("userId", userId)
                    .setParameter("status", state.status().db())
                    .setParameter("provider", state.provider())
                    .setParameter("product", state.productId())
                    .setParameter("plan", BillingRules.Plan.ofStoreProduct(state.productId()).db())
                    .setParameter("amount", (int) BillingRules.storeAmount(state.productId()))
                    .setParameter("now", at(now));
            if (state.storeTransactionId() != null) {
                query.setParameter("txn", state.storeTransactionId());
            }
            bindTimestamp(query, "start", state.periodStart());
            bindTimestamp(query, "end", state.periodEnd());
            bindTimestamp(query, "canceled", state.canceledAt());
            return NativeTuples.list(query);
        });
        return saved.isEmpty() ? StoreSave.BLOCKED : StoreSave.SAVED;
    }

    @Override
    public boolean expireStore(UUID userId, Instant now) {
        return transaction.execute(tx -> subscriptions.expireStore(userId, now)) > 0;
    }

    private static Subscription subscription(BillingSubscriptionEntity row) {
        return new Subscription(
                row.getId(),
                row.getUserId(),
                BillingRules.Status.of(row.getStatus()),
                row.getCustomerKey(),
                row.getBillingKey(),
                row.getCardCompany(),
                row.getCardNumber(),
                row.getAmount(),
                row.getCurrentPeriodStart(),
                row.getCurrentPeriodEnd(),
                row.getCanceledAt(),
                row.getRetryCount(),
                row.getNextRetryAt(),
                row.getProvider(),
                BillingRules.Plan.ofDb(row.getPlan()));
    }

    private static Checkout checkout(BillingCheckoutEntity row) {
        return new Checkout(
                row.getId(),
                row.getUserId(),
                row.getStateHash(),
                BillingRules.Purpose.of(row.getPurpose()),
                row.getCustomerKey(),
                row.getOrderId(),
                row.getExpiresAt(),
                BillingRules.Plan.ofDb(row.getPlan()));
    }

    private static Payment payment(BillingPaymentEntity row) {
        return new Payment(
                row.getId(),
                row.getSubscriptionId(),
                row.getUserId(),
                row.getOrderId(),
                row.getKind(),
                row.getAmount(),
                row.getStatus(),
                row.getPeriodStart(),
                row.getPeriodEnd(),
                row.getAttempt());
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
