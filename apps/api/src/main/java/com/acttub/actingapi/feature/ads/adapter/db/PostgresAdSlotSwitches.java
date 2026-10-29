package com.acttub.actingapi.feature.ads.adapter.db;

import com.acttub.actingapi.feature.ads.app.AdSlotSwitches;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/** 화면별 광고 칸 스위치의 Postgres 구현 — {@code ad_slot_switches} (V76). */
@Repository
class PostgresAdSlotSwitches implements AdSlotSwitches {
    private final EntityManager entityManager;

    PostgresAdSlotSwitches(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public boolean off(String slotKey) {
        Object result = entityManager.createNativeQuery(
                        "SELECT EXISTS (SELECT 1 FROM ad_slot_switches WHERE slot_key=:slot AND NOT enabled)")
                .setParameter("slot", slotKey)
                .getSingleResult();
        return Boolean.TRUE.equals(result);
    }
}
