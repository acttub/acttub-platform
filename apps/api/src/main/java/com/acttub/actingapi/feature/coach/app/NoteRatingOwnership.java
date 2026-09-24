package com.acttub.actingapi.feature.coach.app;

import java.util.UUID;

/**
 * 노트 평가의 주인 바꾸기 — 웹 게스트의 자료를 앱 회원에게 옮길 때 이관이 부른다 (account.guest).
 *
 * <p>회차가 회원에게 가면 그 노트에 남긴 평가도 회원의 것이 된다 — 그래야 회원의 노트 조회에 {@code my_rating}
 * 이 그대로 보인다. 회원과 게스트는 서로의 회차를 가질 수 없어 같은 노트의 행이 부딪히지 않는다.
 *
 * <p><b>부르는 쪽의 트랜잭션에 참여한다.</b>
 */
public interface NoteRatingOwnership {

    void reassign(UUID from, UUID to);
}
