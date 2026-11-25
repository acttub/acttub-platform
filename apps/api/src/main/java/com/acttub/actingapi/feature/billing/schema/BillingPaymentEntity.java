package com.acttub.actingapi.feature.billing.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/** {@code billing_payments}(V64) — 결제 시도 하나. 주문 번호가 유일하고({@code uq_billing_payments_order}) 같은 주문은 한 번만 기록된다. */
@Entity
@Table(name = "billing_payments")
public class BillingPaymentEntity extends AppGeneratedUuidEntity {

    @Column(name = "subscription_id", nullable = false)
    private UUID subscriptionId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "order_id", nullable = false)
    private String orderId;

    @Column(name = "kind", nullable = false)
    private String kind;

    @Column(name = "amount", nullable = false)
    private int amount;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "period_start", nullable = false)
    private Instant periodStart;

    @Column(name = "period_end", nullable = false)
    private Instant periodEnd;

    @Column(name = "attempt", nullable = false)
    private int attempt;

    @Column(name = "approved_at")
    private String approvedAt;

    @Column(name = "failure_code")
    private String failureCode;

    @Column(name = "check_count", nullable = false, insertable = false)
    private int checkCount;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected BillingPaymentEntity() {
    }

    public BillingPaymentEntity(UUID id, UUID subscriptionId, UUID userId, String orderId, String kind, int amount,
            String status, Instant periodStart, Instant periodEnd, int attempt) {
        super(id);
        this.subscriptionId = subscriptionId;
        this.userId = userId;
        this.orderId = orderId;
        this.kind = kind;
        this.amount = amount;
        this.status = status;
        this.periodStart = periodStart;
        this.periodEnd = periodEnd;
        this.attempt = attempt;
    }

    public UUID getSubscriptionId() { return subscriptionId; }
    public UUID getUserId() { return userId; }
    public String getOrderId() { return orderId; }
    public String getKind() { return kind; }
    public int getAmount() { return amount; }
    public String getStatus() { return status; }
    public Instant getPeriodStart() { return periodStart; }
    public Instant getPeriodEnd() { return periodEnd; }
    public int getAttempt() { return attempt; }
}
