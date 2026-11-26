package com.acttub.actingapi.feature.practice.app;

/**
 * 연습 삭제에서 묶음에 딸린 다른 기능의 기록을 정리하는 자리 (practice.library 「연습 삭제」, ADR-040).
 *
 * <p><b>적힌 순서가 실행 순서다.</b> 자리마다 그 표의 주인이 {@link PracticeGroupErasurePart} 로 맡는다.
 */
public enum PracticeGroupErasureStep {
    /** 진행 중인 분석·기억 갱신을 멈추고 작업 행을 사람과 끊는다. */
    AI_JOBS,
    /** 배우가 직접 쓴 일지를 지운다. */
    ACTOR_JOURNALS,
    /** 노트 평가의 한 줄을 비우고 평가 값은 사람과 끊어 남긴다. */
    NOTE_RATINGS,
    /** 의견의 연락처를 비우고 본문은 사람과 끊어 남긴다. */
    PRACTICE_FEEDBACK,
    /** 이 묶음에서 나온 배우 기억을 지운다. */
    ACTOR_MEMORIES
}
