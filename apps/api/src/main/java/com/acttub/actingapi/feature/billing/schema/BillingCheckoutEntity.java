package com.acttub.actingapi.feature.billing.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/** {@code billing_checkouts}(V64) — 카드 등록 창 하나. {@code state_hash} 가 유일하고({@code uq_billing_checkouts_state}) 한 번만 집힌다. */
@Entity
@Table(name = "billing_checkouts")
public class BillingCheckoutEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "state_hash", nullable = false)
    private String stateHash;

    @Column(name = "purpose", nullable = false)
    private String purpose;

    @Column(name = "customer_key", nullable = false)
    private String customerKey;

    @Column(name = "order_id", nullable = false)
    private String orderId;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "result_code")
    private String resultCode;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "plan", nullable = false)
    private String plan;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected BillingCheckoutEntity() {
    }

    public BillingCheckoutEntity(UUID id, UUID userId, String stateHash, String purpose, String customerKey, String orderId,
            String status, Instant expiresAt, String plan) {
        super(id);
        this.userId = userId;
        this.stateHash = stateHash;
        this.purpose = purpose;
        this.customerKey = customerKey;
        this.orderId = orderId;
        this.status = status;
        this.expiresAt = expiresAt;
        this.plan = plan;
    }

    public UUID getUserId() { return userId; }
    public String getStateHash() { return stateHash; }
    public String getPurpose() { return purpose; }
    public String getCustomerKey() { return customerKey; }
    public String getOrderId() { return orderId; }
    public Instant getExpiresAt() { return expiresAt; }
    public String getPlan() { return plan; }
}
