package com.acttub.actingapi.feature.practice.app;

/** 생성 시 고정한 연습 계약. 클라이언트 헤더는 지원 형식이며 권한이 아니다. */
public final class PracticeExperience {
    public static final String LEGACY = "legacy";
    public static final String THREE_LAYERS = "three_layers_v1";
    public static final String HEADER = "X-Acttub-Contract";

    private PracticeExperience() {
    }

    public static boolean supported(String header) {
        return THREE_LAYERS.equals(header);
    }

    /**
     * 클라이언트가 새 계약을 지원하고 배포가 켰으면 새 연습이다. 배우가 상황·인물·목표나 막힘을
     * 적었어도 같다 — 새 코치(연습 루프)가 적은 것을 받아 쓴다(SOMA-508). 예전에는 아무것도
     * 적지 않은 연습에만 붙어서, 하나라도 적으면 예전 코치로 빠졌다.
     */
    public static String select(String header, boolean enabled, NewPracticeSession input) {
        return enabled && supported(header) ? THREE_LAYERS : LEGACY;
    }
}
