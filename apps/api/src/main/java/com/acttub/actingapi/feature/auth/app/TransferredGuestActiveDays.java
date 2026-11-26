package com.acttub.actingapi.feature.auth.app;

import java.util.UUID;

/**
 * 게스트 이관이 닫힐 게스트의 접속일(V41)을 지우게 한다 (account.guest).
 *
 * <p>접속일은 회원에게 옮기지 않는다 — 게스트로 들어온 날은 그 계정의 날이 아니다.
 */
public interface TransferredGuestActiveDays {

    /** 부르는 쪽의 이관 트랜잭션에 참여한다. */
    void discard(UUID guestId);
}
