package com.acttub.actingapi.feature.challenge.domain;

import java.time.Duration;

/** 챌린지는 대사와 기간이다. 길이는 유니코드 코드 포인트로 센다. */
public final class ChallengeRules {
    public static final int DAILY_CREATIONS = 3;
    /** 챌린지 영상은 60초 이내다(촬영 상한과 같다). 서버가 실제 길이로 확인한다. */
    public static final int ENTRY_VIDEO_MAX_MS = 60_000;
    public static final int DAILY_ENTRIES = 3;
    public static final int CAPTION_MAX = 300;
    /** 참여작 목록·피드 한 쪽. */
    public static final int ENTRY_PAGE = 20;
    /** 좋아요순 첫 조회의 순서를 이만큼 굳혀 페이지 사이에 순위가 튀지 않게 한다. */
    public static final Duration RANKING_HOLD = Duration.ofMinutes(10);
    /** 조회수 사건의 중복 제거 기간. */
    public static final Duration VIEW_EVENT_RETENTION = Duration.ofDays(7);
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
