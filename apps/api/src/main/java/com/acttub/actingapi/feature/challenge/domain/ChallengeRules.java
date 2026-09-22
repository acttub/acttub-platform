package com.acttub.actingapi.feature.challenge.domain;

/** 챌린지는 대사와 기간이다. 길이는 유니코드 코드 포인트로 센다. */
public final class ChallengeRules {
    public static final int DAILY_CREATIONS = 3;
    private ChallengeRules() { }

    public static String normalize(String value) {
        return value == null ? "" : value.replaceAll("(?U)[\\s\\uFEFF]+", " ").strip();
    }

    public static String trim(String value) {
        return value == null ? "" : value.replaceAll("(?U)^[\\s\\uFEFF]+|[\\s\\uFEFF]+$", "");
    }

    public static boolean length(String value, int minimum, int maximum) {
        int size = value.codePointCount(0, value.length());
        return size >= minimum && size <= maximum;
    }

    public static boolean duration(int days) { return days == 7 || days == 14; }

}
