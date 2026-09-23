package com.acttub.actingapi.feature.reading.app;

import java.util.UUID;

/**
 * 리딩 자료의 주인 바꾸기 — 웹 게스트의 자료를 앱 회원에게 옮길 때 이관이 부른다 (account.guest, 03-reading
 * 「리딩 자료의 이관·삭제·탈퇴」).
 *
 * <p>대본·회차·녹음·암기 상태의 {@code user_id} 만 바꾸므로 배역·줄·객체가 그대로 따라간다. 게스트와 회원의
 * {@code request_id} 가 겹치면(UUID 라 실질적으로 없다) 게스트 쪽 값을 비운다. <b>부르는 쪽의 트랜잭션에
 * 참여한다</b>(자기 {@code TransactionTemplate} 을 쓰지 않는다, apps/api/CONTRACT.md §6-9).
 *
 * <p>옮기기 전에 게스트의 {@code users} 행을 잡는다 — 리딩의 쓰기가 같은 행을 잡고 활성인지 보므로, 겹쳐도
 * 순서가 정해진다: 쓰기가 먼저면 그 행까지 옮기고, 이관이 먼저면 쓰기가 닫힌 계정을 보고 쓰지 않는다.
 */
public interface ReadingOwnership {

    void reassign(UUID from, UUID to);
}
