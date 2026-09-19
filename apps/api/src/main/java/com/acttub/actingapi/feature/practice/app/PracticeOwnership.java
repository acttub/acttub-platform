package com.acttub.actingapi.feature.practice.app;

import java.util.UUID;

/**
 * 연습의 주인 바꾸기 — 웹 게스트의 자료를 앱 회원에게 옮길 때 이관이 부른다 (account.guest, ADR-028).
 * 복사가 아니라 주인만 바꾸므로 분석·대화·노트가 그대로 따라간다. <b>부르는 쪽의 트랜잭션에 참여한다.</b>
 */
public interface PracticeOwnership {

    void reassign(UUID from, UUID to);
}
