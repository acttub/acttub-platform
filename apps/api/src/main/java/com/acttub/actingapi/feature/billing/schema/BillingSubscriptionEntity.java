package com.acttub.actingapi.feature.billing.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code billing_subscriptions}(V64) — 회원 한 명의 Pro 구독({@code uq_billing_subscriptions_user}). 상태·결제 수단·요금제는 DB 값
 * 그대로 문자열이다. CHECK 가 없어 {@code BillingRules} 와 저장소 문장이 값을 지킨다(apps/api/CONTRACT.md §5-3 ①).
 */
@Entity
@Table(name = "billing_subscriptions")
public class BillingSubscriptionEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "provider", nullable = false)
    private String provider;

    @Column(name = "customer_key")
    private String customerKey;

    @Column(name = "billing_key")
    private String billingKey;

    @Column(name = "card_company")
    private String cardCompany;

    @Column(name = "card_number")
    private String cardNumber;

    @Column(name = "amount", nullable = false)
    private int amount;

    @Column(name = "current_period_start")
    private Instant currentPeriodStart;

    @Column(name = "current_period_end")
    private Instant currentPeriodEnd;

    @Column(name = "canceled_at")
    private Instant canceledAt;

    @Column(name = "retry_count", nullable = false)
    private int retryCount;

    @Column(name = "next_retry_at")
    private Instant nextRetryAt;

    @Column(name = "lease_until")
    private Instant leaseUntil;

    @Column(name = "plan", nullable = false)
    private String plan;

    @Column(name = "store_product_id")
    private String storeProductId;

    @Column(name = "store_transaction_id")
    private String storeTransactionId;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected BillingSubscriptionEntity() {
    }

    public BillingSubscriptionEntity(UUID id, UUID userId, String status, String provider, int amount, String plan) {
        super(id);
        this.userId = userId;
        this.status = status;
        this.provider = provider;
        this.amount = amount;
        this.plan = plan;
    }

    public UUID getUserId() { return userId; }
    public String getStatus() { return status; }
    public String getProvider() { return provider; }
    public String getCustomerKey() { return customerKey; }
    public String getBillingKey() { return billingKey; }
    public String getCardCompany() { return cardCompany; }
    public String getCardNumber() { return cardNumber; }
    public int getAmount() { return amount; }
    public Instant getCurrentPeriodStart() { return currentPeriodStart; }
    public Instant getCurrentPeriodEnd() { return currentPeriodEnd; }
    public Instant getCanceledAt() { return canceledAt; }
    public int getRetryCount() { return retryCount; }
    public Instant getNextRetryAt() { return nextRetryAt; }
    public String getPlan() { return plan; }
}
