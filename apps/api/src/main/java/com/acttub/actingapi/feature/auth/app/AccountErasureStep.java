package com.acttub.actingapi.feature.auth.app;

/**
 * 닫힌 계정의 자료를 지우는 자리들. <b>적힌 순서가 실행 순서다</b>({@link AccountErasureSequence}).
 *
 * <p>자리마다 주인 기능 하나가 맡는다({@link AccountErasure#steps}). 한 기능이 여러 자리를 맡을 수 있다. 순서는 잠금을 잡는
 * 순서이기도 해서, 자리를 옮기면 겹친 쓰기와의 교착·결과가 달라질 수 있다. 지켜야 하는 앞뒤:
 *
 * <ul>
 *   <li>객체 키는 그 행을 지우거나 키를 비우기 전에 읽는다. 자리마다 그 구현 안에서 지킨다: 읽은 키의 삭제를 정리 장부에 올리고
 *       그 id 를 돌려준다.</li>
 *   <li>리프레시 토큰을 폐기한 뒤에 접속일을 지운다(둘 다 {@link #SESSIONS} 안이다).</li>
 * </ul>
 *
 * <p>이 목록보다 앞서는 일({@code users} 행 잠금, 밀린 마감 집계, 상태 전환, 보관 동의 읽기)의 순서는
 * {@link AccountErasureSequence#close} 에 있다.
 */
public enum AccountErasureStep {
    /** 대본·회차·녹음·암기 상태. */
    READING,
    /** 영상 행을 잠그고, 영상을 남기지 않을 때 객체 삭제를 장부에 올리고 파일을 파기한 것으로 적는다. */
    VIDEO_FILES,
    /** 진행 중인 AI 작업을 닫는다. */
    AI_JOBS,
    /** 배우 일지. */
    ACTOR_JOURNALS,
    /** 의견의 연락처. */
    PRACTICE_FEEDBACK,
    /** 노트 평가의 한 줄. */
    NOTE_RATINGS,
    /** 앞서 지운 연습의 무료 횟수 표시와 보관하던 영상. */
    DELETED_PRACTICES,
    /** 주최한 챌린지, 참여작(영상을 남기지 않을 때 모자이크본·공유 프레임 객체도), 차단, 저장, 알림, AI 리포트. */
    CHALLENGE,
    /** 게시판 글 사진(행과 객체). */
    COMMUNITY_IMAGES,
    /** 고품질 목소리 사용량. */
    READING_VOICE_USAGE,
    /** 가입 유입 기록과 재조회용 기기 ID. */
    SIGNUP_ATTRIBUTION,
    /** 구독 끝내기, Pro 지급, 열린 결제창. */
    BILLING,
    /** 가입 직후 답한 유입 경로. */
    DISCOVERY_ANSWER,
    /** 신원을 해시로 바꾸고 제공자 해제를 장부에 올린다. 게스트 신원은 지운다. */
    IDENTITIES,
    /** RevenueCat 고객 삭제를 장부에 올린다. */
    BILLING_CUSTOMER,
    /** 이메일과 옛 닉네임. */
    EMAIL,
    /** 프로필의 이름·사진(객체도)·소개를 지우고 생년월일을 연령대로 바꾼다. */
    PROFILE,
    /** 포트폴리오(사진 객체도). */
    PORTFOLIO,
    /** 살아 있는 이관 코드. */
    TRANSFER_CODES,
    /** 리프레시 토큰 폐기, 접속일. */
    SESSIONS,
    /** 푸시 토큰, 연습 알림 보낸 기록, 푸시를 눌러 연 기록. */
    PUSH,
    /** 옛 연습 흐름의 분석 중이던 연습. */
    LEGACY_PRACTICES,
    /** 옛 연습 흐름의 진행 중인 작업. */
    LEGACY_OPERATIONS
}
