package com.acttub.actingapi.feature.practice.domain;

/**
 * 회차의 규칙 — 입력 한도와 기본값 (practice.start, practice.resume). 프레임워크를 모른다.
 *
 * <p>Scene Context 는 <b>셋 모두 선택</b>이다. 비우면 빈 문자열로 저장하고 시작 뒤에는 바꾸지 않는다 — 코치가
 * 대화에서 장면을 물어도 그 답은 Scene Context 가 되지 않는다(ADR-021 개정). 막힘을 고르지 않으면 "그 외/그 외"
 * 이고 막힘 미특정 회차라고 부른다.
 */
public final class PracticeRules {

    /** 상황·인물·목표 각각의 상한(자). */
    public static final int SCENE_MAX_CHARS = 300;

    /** 막힘 서술의 상한(자). */
    public static final int BLOCKAGE_NOTE_MAX_CHARS = 500;

    /** 묶음 제목의 상한(자). 시작 때 적는 제목과 묶음 속성 수정이 같은 한도다. */
    public static final int GROUP_TITLE_MAX_CHARS = 200;

    /** 회차에 싣는 포스터 서명 주소의 수명(초). 보관함의 포스터·재생 주소와 같은 10분이다. */
    public static final int POSTER_URL_TTL_SECONDS = 600;

    /** 게스트의 하루 분석 요청 수. 한국 시간 자정에 끊는다. */
    public static final int GUEST_DAILY_ANALYSES = 3;

    /** 코칭 세션 목적(SOMA-719). 앱이 코칭을 시작할 때 고른다. 없으면 목적 없는 회차(지금 코치)다. */
    public static final java.util.List<String> SESSION_PURPOSES = java.util.List.of("evaluate", "stuck", "character", "concern");

    /**
     * 영상 없이 말로 시작할 수 있는 목적(SOMA-745): 막힌 곳 풀기·인물 이해하기·고민 상담. 고민 상담은 영상 없는 회차에만 쓴다.
     */
    public static final java.util.List<String> TALK_PURPOSES = java.util.List.of("stuck", "character", "concern");

    /**
     * 영상과 목적의 짝이 맞는가. 영상이 없으면 말로 하는 목적이어야 한다. 영상이 있으면 목적은 무엇이든(없어도) 된다 —
     * 영상과 함께 온 고민 상담은 목적 없는 회차처럼 지금 코치가 받는다. 목적은 {@link #sessionPurpose(String)} 로 고른 값이다.
     */
    public static boolean videoMatchesPurpose(boolean withVideo, String purpose) {
        return withVideo || purpose != null && TALK_PURPOSES.contains(purpose);
    }

    /** 목적 값. 앞뒤 공백을 떼고 비면 없는 것({@code null})이다. 값 검사는 요청 검증이 먼저 한다. */
    public static String sessionPurpose(String value) {
        if (value == null || value.isBlank()) return null;
        String purpose = value.strip();
        return SESSION_PURPOSES.contains(purpose) ? purpose : null;
    }

    /** 고르지 않은 막힘. */
    public static final String UNSPECIFIED = "그 외";

    private PracticeRules() {
    }

    /** 비어 있으면 빈 문자열, 아니면 그대로. 앞뒤 공백만 있는 값도 빈 것으로 본다. */
    public static String scene(String value) {
        return value == null || value.isBlank() ? "" : value;
    }

    /** 고르지 않았으면 "그 외". */
    public static String blockage(String value) {
        return value == null || value.isBlank() ? UNSPECIFIED : value;
    }

    /** 시작 때 적는 묶음 제목. 앞뒤 공백을 떼고, 비면 없는 것이다 — 화면이 대체 규칙으로 채운다. */
    public static String title(String value) {
        return value == null || value.isBlank() ? null : value.strip();
    }

    /** 막힘 서술은 비어 있으면 아예 없는 것이다(빈 문자열을 남기지 않는다). */
    public static String note(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    /**
     * 그 회차가 신형인가 — 서버 플래그가 켜져 있고 계약 헤더가 신형이면 신형이다(practice.start). 배우가 장면·막힘을
     * 적었어도 같다 — 새 코치(연습 루프)가 적은 것을 받아 쓴다(SOMA-508). 예전에는 무입력일 때만 신형이었다.
     */
    public static boolean threeLayers(boolean enabled, String contractHeader) {
        return enabled && "three_layers_v1".equals(contractHeader);
    }
}
