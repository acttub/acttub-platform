package com.acttub.actingapi.feature.push.app;

import java.util.List;
import java.util.UUID;

public interface PushTokenRepository {

    /**
     * 토큰을 이 사용자의 것으로 기록한다. 토큰이 곧 단말이므로 이미 있으면 소유자를
     * 갈아탄다(같은 폰에 다른 계정이 로그인한 경우) — 멱등하다.
     */
    void register(UUID userId, String token, String platform);

    /**
     * 이 토큰의 행을 지운다. <b>주인을 따지지 않는다</b> — 로그아웃한 기기에는 액세스 토큰이 없어, 푸시
     * 토큰을 갖고 있다는 것이 본인 확인이다. 없어도 조용히 지나간다(멱등).
     */
    void unregister(String token);

    /**
     * 분석 완료를 알릴 토큰 — 연습 세션 <b>지금의</b> 주인의 토큰 전부. 주인이 분석 완료 알림을 꺼 두었으면
     * 빈 목록이다(프로필의 토글을 읽어 거른다). 세션이 없으면 빈 목록.
     */
    List<String> analysisDoneTargets(UUID sessionId);

    /**
     * 이 회원이 서버 푸시 둘(분석 완료·챌린지)을 다 꺼 두었는가. 그동안에는 토큰을 받지 않는다 — 둘을 다
     * 끄면 그 회원의 토큰을 전부 지우고, 하나를 다시 켜면 앱이 다시 등록한다.
     */
    boolean pushesTurnedOff(UUID userId);
}
