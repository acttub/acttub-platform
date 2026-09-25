package com.acttub.actingapi.feature.video.app;

import java.util.UUID;

/**
 * 보관함의 주인 바꾸기 — 웹 게스트의 영상을 앱 회원에게 옮길 때 이관이 부른다 (account.guest, 02-practice
 * 「연습 자료의 이관·삭제·탈퇴」).
 *
 * <p>{@code videos.user_id} 만 바꾸므로 객체는 그대로이고 받아쓰기·회차가 따라간다. 예약 장부
 * ({@code upload_intents})도 함께 옮겨 옛 게스트의 대기 업로드가 마무리될 자리를 잃지 않는다.
 *
 * <p><b>부르는 쪽의 트랜잭션에 참여한다</b>(자기 {@code TransactionTemplate} 을 쓰지 않는다, CONTRACT §6-9).
 */
public interface VideoOwnership {

    void reassign(UUID from, UUID to);
}
