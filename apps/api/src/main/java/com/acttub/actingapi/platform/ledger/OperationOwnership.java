package com.acttub.actingapi.platform.ledger;

import java.util.UUID;

/**
 * 작업 장부의 주인 바꾸기 — 웹 게스트의 자료를 앱 회원에게 옮길 때 이관이 부른다 (account.guest).
 * 진행 중인 작업도 따라간다: 상태와 lease 는 건드리지 않으므로 돌고 있던 워커가 그대로 끝내고, 완료
 * 알림은 그때의 주인(회원)에게 간다. <b>부르는 쪽의 트랜잭션에 참여한다.</b>
 */
public interface OperationOwnership {

    void reassign(UUID from, UUID to);
}
