package com.acttub.actingapi.feature.practice.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 연습 삭제(practice.library 「연습 삭제」, SOMA-985). 묶음 하나를 배우에게서 지운다.
 *
 * <ul>
 *   <li>회차·분석·노트·대화·노트 평가·의견은 「지운 연습 보관 계정」으로 옮겨 <b>사람과 끊어 남긴다</b> — 탈퇴의
 *       연습 기록과 같은 대우다. 배우가 직접 쓴 일지와 노트 평가의 한 줄, 의견의 연락처는 지운다.</li>
 *   <li>그 묶음에서 나온 배우 기억은 지운다(기억 세대 +1).</li>
 *   <li>영상은 다른 묶음·챌린지 참여작이 쓰지 않을 때만 함께 지운다. 보관 동의 현재 판에 동의했으면 파일을 지운 날부터
 *       3년 남기고, 아니면 파일을 파기한다. 어느 쪽이든 배우의 보관함에서 빠진다.</li>
 *   <li>지운 회차의 시각은 남겨 오늘 쓴 무료 코칭 횟수에서 빠지지 않게 한다.</li>
 * </ul>
 *
 * <p>선언은 쓰는 쪽(여기)에 있고 구현은 정리 장부와 보관 동의를 가진 {@code profile} 이 한다 (ADR-017,
 * {@code video/app/VideoObjectCleanup} 과 같은 형태).
 */
public interface PracticeGroupErasure {

    /**
     * 한 트랜잭션에서 지운다.
     *
     * @return 없거나 남의 묶음이거나 활성 회원이 아니면 {@code null}. 있으면 장부에 올린 객체 삭제들 — 부르는 쪽이
     *         커밋 뒤에 {@link #attempt} 한다
     */
    List<UUID> erase(UUID userId, UUID rootId, Instant now);

    /** 방금 올린 것을 커밋 뒤에 바로 한 번 시도한다. 어떤 실패도 밖으로 나가지 않는다. */
    void attempt(List<UUID> operationIds);
}
