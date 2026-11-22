package com.acttub.actingapi.feature.ads.app;

/** 화면별 광고 칸 스위치 — {@code ad_slot_switches} (V76). 줄이 없으면 켜진 것으로 본다. */
public interface AdSlotSwitches {

    AdSlotSwitches ALWAYS_ON = slotKey -> false;

    /** 이 칸을 서버에서 꺼 뒀는가. */
    boolean off(String slotKey);

    /**
     * 이 칸을 enabled=true 줄로 켜 뒀는가 — 줄이 있어야 켜지는 전면 칸(SOMA-1085)이 쓴다. 기본은 {@code !off}(줄 없음 = 켜짐)이고,
     * 저장소 구현은 줄이 실제로 있는지 본다.
     */
    default boolean switchedOn(String slotKey) {
        return !off(slotKey);
    }
}
