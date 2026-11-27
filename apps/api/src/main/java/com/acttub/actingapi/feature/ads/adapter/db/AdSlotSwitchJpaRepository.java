package com.acttub.actingapi.feature.ads.adapter.db;

import com.acttub.actingapi.feature.ads.schema.AdSlotSwitchEntity;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code ad_slot_switches} 를 읽는 문장(apps/api/CONTRACT.md §5-9). */
interface AdSlotSwitchJpaRepository extends Repository<AdSlotSwitchEntity, String> {

    @Query("select exists (select 1 from AdSlotSwitchEntity s where s.slotKey = :slot and not s.enabled)")
    boolean off(String slot);

    @Query("select exists (select 1 from AdSlotSwitchEntity s where s.slotKey = :slot and s.enabled)")
    boolean switchedOn(String slot);
}
