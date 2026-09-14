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

    public static String select(String header, boolean enabled, NewPracticeSession input) {
        return enabled && supported(header)
                && blank(input.situation()) && blank(input.characterContext()) && blank(input.goal())
                && "그 외".equals(input.blockageKind()) && blank(input.blockageDetail())
                ? THREE_LAYERS : LEGACY;
    }

    private static boolean blank(String value) {
        return value == null || value.isBlank() || ".".equals(value.strip());
    }
}
