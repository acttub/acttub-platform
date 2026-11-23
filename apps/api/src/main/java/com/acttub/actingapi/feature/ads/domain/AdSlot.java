package com.acttub.actingapi.feature.ads.domain;

import java.util.Arrays;
import java.util.Optional;

/**
 * 앱의 광고 칸(SOMA-876). 키는 앱과 서버가 같이 쓰는 이름이다.
 * BROWSE 는 둘러보는 화면(무료·Pro 모두), PRACTICE 는 연습 중 기다리는 자리(무료만, 기본은 전원에게 켠다).
 * COMMUNITY 는 게시판(SOMA-873) 자리로 키만 예약한다 — 둘러보기와 같은 규칙이다.
 *
 * <p>전면 칸({@code fullScreen}, SOMA-1085)은 앱이 화면 전체를 덮는 AdMob 전면 광고를 띄우는 자리다. 학원·우리 앱 광고는 붙이지 않고
 * NETWORK 아니면 NONE 이며, 규격(size)은 쓰지 않는다. 다른 칸과 달리 {@code ad_slot_switches} 에 enabled=true 줄을 넣어야 켜지고,
 * 연습 중 배너 A/B 비율({@code ADS_PRACTICE_SLOT_PERCENT})은 따르지 않는다. 첫 연습 전·Pro 는 다른 칸처럼 NONE 이다.
 */
public enum AdSlot {
    AUDITIONS_TOP("auditions_top", AdSize.LARGE_BANNER, Phase.BROWSE),
    ADMISSIONS_TOP("admissions_top", AdSize.LARGE_BANNER, Phase.BROWSE),
    ADMISSION_DETAIL_TOP("admission_detail_top", AdSize.LARGE_BANNER, Phase.BROWSE),
    READING_TAB_TOP("reading_tab_top", AdSize.LARGE_BANNER, Phase.BROWSE),
    CHALLENGES_TAB_TOP("challenges_tab_top", AdSize.LARGE_BANNER, Phase.BROWSE),
    CHALLENGE_DETAIL_TOP("challenge_detail_top", AdSize.LARGE_BANNER, Phase.BROWSE),
    ARCHIVE_TOP("archive_top", AdSize.LARGE_BANNER, Phase.BROWSE),
    SAVED_VIDEOS_TOP("saved_videos_top", AdSize.LARGE_BANNER, Phase.BROWSE),
    HOME_TOP("home_top", AdSize.BANNER, Phase.BROWSE),
    PROFILE_TOP("profile_top", AdSize.BANNER, Phase.BROWSE),
    SETTINGS_TOP("settings_top", AdSize.BANNER, Phase.BROWSE),
    ANALYZING_TOP("analyzing_top", AdSize.BANNER, Phase.BROWSE),
    REPORT_TOP("report_top", AdSize.BANNER, Phase.BROWSE),
    NOTIFICATIONS_TOP("notifications_top", AdSize.BANNER, Phase.BROWSE),
    LINE_SEARCH_TOP("line_search_top", AdSize.BANNER, Phase.BROWSE),
    ANALYZING_WAIT("analyzing_wait", AdSize.MEDIUM_RECTANGLE, Phase.PRACTICE),
    VOICE_PREPARE_WAIT("voice_prepare_wait", AdSize.MEDIUM_RECTANGLE, Phase.PRACTICE),
    UPLOAD_WAIT("upload_wait", AdSize.LARGE_BANNER, Phase.PRACTICE),
    SCRIPT_PARSE_WAIT("script_parse_wait", AdSize.LARGE_BANNER, Phase.PRACTICE),
    COACHING_DONE("coaching_done", AdSize.LARGE_BANNER, Phase.PRACTICE),
    CHALLENGE_UPLOAD_DONE("challenge_upload_done", AdSize.LARGE_BANNER, Phase.PRACTICE),
    COMMUNITY_LIST_TOP("community_list_top", AdSize.BANNER, Phase.BROWSE),
    COMMUNITY_POST_TOP("community_post_top", AdSize.BANNER, Phase.BROWSE),
    /** 코칭 영상 분석을 기다리기 시작할 때 전면 광고. */
    ANALYZING_WAIT_FULL("analyzing_wait_full", AdSize.MEDIUM_RECTANGLE, Phase.PRACTICE, true),
    /** 리딩 대본 나누기를 시작할 때 전면 광고. */
    SCRIPT_PARSE_FULL("script_parse_full", AdSize.MEDIUM_RECTANGLE, Phase.PRACTICE, true),
    /** 리딩을 끝내고 결과로 넘어갈 때 전면 광고. */
    READING_DONE_FULL("reading_done_full", AdSize.MEDIUM_RECTANGLE, Phase.PRACTICE, true);

    public enum Phase { BROWSE, PRACTICE }

    private final String key;
    private final AdSize size;
    private final Phase phase;
    private final boolean fullScreen;

    AdSlot(String key, AdSize size, Phase phase) {
        this(key, size, phase, false);
    }

    AdSlot(String key, AdSize size, Phase phase, boolean fullScreen) {
        this.key = key;
        this.size = size;
        this.phase = phase;
        this.fullScreen = fullScreen;
    }

    public String key() {
        return key;
    }

    public AdSize size() {
        return size;
    }

    public Phase phase() {
        return phase;
    }

    /** 앱이 AdMob 전면 광고를 띄우는 칸인가. */
    public boolean fullScreen() {
        return fullScreen;
    }

    public static Optional<AdSlot> of(String key) {
        return Arrays.stream(values()).filter(slot -> slot.key.equals(key)).findFirst();
    }
}
