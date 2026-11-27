package com.acttub.actingapi.feature.ads.adapter.db;

import com.acttub.actingapi.feature.ads.app.AdSlotSwitches;
import org.springframework.stereotype.Repository;

/** 화면별 광고 칸 스위치의 Postgres 구현 — {@code ad_slot_switches} (V76). */
@Repository
class PostgresAdSlotSwitches implements AdSlotSwitches {
    private final AdSlotSwitchJpaRepository switches;

    PostgresAdSlotSwitches(AdSlotSwitchJpaRepository switches) {
        this.switches = switches;
    }

    @Override
    public boolean off(String slotKey) {
        return switches.off(slotKey);
    }

    @Override
    public boolean switchedOn(String slotKey) {
        return switches.switchedOn(slotKey);
    }
}
