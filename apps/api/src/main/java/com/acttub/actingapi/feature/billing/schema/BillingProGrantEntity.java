package com.acttub.actingapi.feature.billing.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code billing_pro_grants}(V64) — 결제 없이 준 Pro 기간. 앱은 지금 걸친 부여의 끝을 읽는다(V68 마이그레이션이 넣은 행이 있다). 앱 코드가
 * 넣는 곳은 친구 초대 보상({@code ProGrants}, SOMA-865) 하나다.
 */
@Entity
@Table(name = "billing_pro_grants")
public class BillingProGrantEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "starts_at", nullable = false)
    private Instant startsAt;

    @Column(name = "ends_at", nullable = false)
    private Instant endsAt;

    @Column(name = "reason", nullable = false)
    private String reason;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    protected BillingProGrantEntity() {
    }

    public BillingProGrantEntity(UUID id, UUID userId, Instant startsAt, Instant endsAt, String reason) {
        super(id);
        this.userId = userId;
        this.startsAt = startsAt;
        this.endsAt = endsAt;
        this.reason = reason;
    }
}
