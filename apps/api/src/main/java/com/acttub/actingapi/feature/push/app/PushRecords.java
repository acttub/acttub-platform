package com.acttub.actingapi.feature.push.app;

import java.util.UUID;

/**
 * 닫히는 게스트의 푸시 기록과 푸시 토큰을 지운다 (account.guest).
 *
 * <p>연습 알림 보낸 기록(V47)과 푸시를 눌러 연 기록(V72)은 회원에게 옮기지 않는다. 게스트 이관이 닫힐 게스트의 행만 지운다.
 * 푸시 토큰도 옮기지 않고 지운다 — 닫힌 계정의 행은 30일 파기도 고르지 않아 지울 길이 없다. 회원의 폰은 회원으로
 * 토큰을 등록한다.
 */
public interface PushRecords {

    /** 부르는 쪽의 이관 트랜잭션에 참여한다. */
    void discardTransferredGuest(UUID guestId);
}
