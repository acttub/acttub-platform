package com.acttub.actingapi.feature.ads.schema;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code ad_events}(V66) — 직접·자체 광고의 노출과 클릭 한 건. 노출은 한 사람·광고·한국 날짜에 한 번이다(부분 유니크 인덱스
 * {@code uq_ad_events_impression}). 쓰기는 HQL insert 뿐이다.
 */
@Entity
@Table(name = "ad_events")
public class AdEventEntity extends AppGeneratedUuidEntity {

    @Column(name = "ad_id", nullable = false)
    private UUID adId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "slot", nullable = false)
    private String slot;

    @Column(name = "event", nullable = false)
    private String event;

    @Column(name = "day", nullable = false)
    private LocalDate day;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected AdEventEntity() {
    }

    public AdEventEntity(UUID id, UUID adId, UUID userId, String slot, String event, LocalDate day, Instant createdAt) {
        super(id);
        this.adId = adId;
        this.userId = userId;
        this.slot = slot;
        this.event = event;
        this.day = day;
        this.createdAt = createdAt;
    }
}
