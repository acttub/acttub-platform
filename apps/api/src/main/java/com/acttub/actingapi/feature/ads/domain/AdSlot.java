package com.acttub.actingapi.feature.ads.domain;

import java.util.Arrays;
import java.util.Optional;

/**
 * 앱의 광고 칸(SOMA-876). 키는 앱과 서버가 같이 쓰는 이름이다.
 * BROWSE 는 둘러보는 화면(무료·Pro 모두), PRACTICE 는 연습 중 기다리는 자리(무료만, A/B 로 절반만 켠다).
 * COMMUNITY 는 게시판(SOMA-873) 자리로 키만 예약한다 — 둘러보기와 같은 규칙이다.
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
    COMMUNITY_LIST_TOP("community_list_top", AdSize.LARGE_BANNER, Phase.BROWSE),
    COMMUNITY_POST_TOP("community_post_top", AdSize.BANNER, Phase.BROWSE);

    public enum Phase { BROWSE, PRACTICE }

    private final String key;
    private final AdSize size;
    private final Phase phase;

    AdSlot(String key, AdSize size, Phase phase) {
        this.key = key;
        this.size = size;
        this.phase = phase;
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

    public static Optional<AdSlot> of(String key) {
        return Arrays.stream(values()).filter(slot -> slot.key.equals(key)).findFirst();
    }
}
