package com.acttub.actingapi.feature.profile.domain;

import java.util.List;

/**
 * 가입 직후 배우가 답한 "액터브를 처음 어디서 알게 됐어요?" (SOMA-649). 계정마다 처음 답만 남는다.
 *
 * <p>Airbridge 설치 귀속({@link SignupAttribution})과 뜻이 다르다 — 이쪽은 배우가 기억하는 첫 경로(자기 응답)다.
 * 둘을 나란히 놓아 귀속이 놓친 몫을 가늠한다.
 *
 * @param source 고른 경로. {@code null} 이면 건너뛰었다
 * @param detail 인스타그램을 골랐을 때만의 세부. 그 밖에는 {@code null}
 * @param otherText '기타'를 골랐을 때만의 직접 입력(1~{@value #OTHER_TEXT_MAX_LENGTH}자). 그 밖에는 {@code null}
 */
public record DiscoveryAnswer(String source, String detail, String otherText) {

    /** 값 이름은 API 값이고 DB CHECK(V38)와 같은 목록이다. */
    public static final List<String> SOURCES = List.of(
            "instagram", "naver_search", "google_youtube", "app_store_search",
            "friend", "academy_school", "community", "other");
    public static final List<String> INSTAGRAM_DETAILS = List.of("ad", "official_post", "other_post", "unknown");
    public static final String INSTAGRAM = "instagram";
    public static final String OTHER = "other";
    public static final int OTHER_TEXT_MAX_LENGTH = 30;
}
