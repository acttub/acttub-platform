package com.acttub.actingapi.feature.ads.schema;

import java.time.Instant;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/** {@code ad_slot_switches}(V76) — 화면별 광고 칸 스위치. 앱은 읽기만 하고 운영자가 SQL 로 끄고 켠다. */
@Entity
@Table(name = "ad_slot_switches")
public class AdSlotSwitchEntity {

    @Id
    @Column(name = "slot_key", nullable = false)
    private String slotKey;

    @Column(name = "enabled", nullable = false)
    private boolean enabled;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected AdSlotSwitchEntity() {
    }
}
