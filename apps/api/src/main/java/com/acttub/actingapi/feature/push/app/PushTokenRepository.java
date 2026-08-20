package com.acttub.actingapi.feature.push.app;

import java.util.List;
import java.util.UUID;

public interface PushTokenRepository {

    /**
     * 토큰을 이 사용자의 것으로 기록한다. 토큰이 곧 단말이므로 이미 있으면 소유자를
     * 갈아탄다(같은 폰에 다른 계정이 로그인한 경우) — 멱등하다.
     */
    void register(UUID userId, String token, String platform);

    /** 이 사용자의 이 토큰만 지운다. 없어도 조용히 지나간다(멱등). */
    void unregister(UUID userId, String token);

    /** 연습 세션 주인의 토큰 전부. 세션이 없으면 빈 목록. */
    List<String> tokensForSessionOwner(UUID sessionId);
}
