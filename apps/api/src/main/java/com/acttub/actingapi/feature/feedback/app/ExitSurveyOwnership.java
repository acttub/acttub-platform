package com.acttub.actingapi.feature.feedback.app;

import java.util.UUID;

/**
 * 이탈 설문의 주인 바꾸기 — 웹 게스트의 자료를 앱 회원에게 옮길 때 이관이 부른다 (account.guest).
 *
 * <p>설문 이력 행은 모두 회원으로 옮기고, <b>게스트·회원 어느 쪽이든 물어봤으면 회원도 물어본 것</b>이다
 * (practice.feedback) — 옮긴 뒤 앱에서 시트가 다시 뜨지 않는다.
 *
 * <p><b>부르는 쪽의 트랜잭션에 참여한다.</b>
 */
public interface ExitSurveyOwnership {

    void reassign(UUID from, UUID to);
}
