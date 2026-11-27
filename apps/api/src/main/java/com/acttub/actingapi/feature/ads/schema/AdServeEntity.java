package com.acttub.actingapi.feature.ads.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/** {@code ad_serves}(V78) — 사람에게 실제로 내보낸 광고 한 번. 빈도 상한이 세고 하루 한 번 오래된 것을 지운다. */
@Entity
@Table(name = "ad_serves")
public class AdServeEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "served_at", nullable = false)
    private Instant servedAt;

    protected AdServeEntity() {
    }

    public AdServeEntity(UUID id, UUID userId, Instant servedAt) {
        super(id);
        this.userId = userId;
        this.servedAt = servedAt;
    }
}
