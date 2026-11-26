package com.acttub.actingapi.feature.push.app;

import java.util.UUID;

/**
 * 회원의 푸시 토큰을 전부 지운다 (account.notification).
 *
 * <p>서버 푸시 셋을 다 끌 때 토글을 고치는 쪽이 부른다. "셋 다 꺼짐"과 "토큰 없음"이 한 트랜잭션이어야 꺼 놓고도 알림이 오는
 * 틈이 생기지 않는다. 하나를 다시 켜면 앱이 이 폰의 토큰을 다시 등록한다.
 */
public interface PushTokenRevocation {

    /** 부르는 쪽의 트랜잭션에 참여한다. */
    void revokeAllOf(UUID userId);
}
