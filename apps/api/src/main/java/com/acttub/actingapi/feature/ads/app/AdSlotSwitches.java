package com.acttub.actingapi.feature.ads.app;

/** 화면별 광고 칸 스위치 — {@code ad_slot_switches} (V76). 줄이 없으면 켜진 것으로 본다. */
public interface AdSlotSwitches {

    AdSlotSwitches ALWAYS_ON = slotKey -> false;

    /** 이 칸을 서버에서 꺼 뒀는가. */
    boolean off(String slotKey);
}
