package com.acttub.actingapi.feature.push.app;

import java.util.List;

/**
 * 알림을 실어 나르는 포트. 구현은 Expo Push API({@code adapter/expo})이고,
 * 테스트는 보낸 것을 쌓아 두는 가짜로 대신한다.
 *
 * <p>실패는 던지지 않고 삼킨다 — 알림은 최선 노력(best effort)이고, 부르는 쪽
 * (분석 완료 전이)의 성패를 바꿔서는 안 된다.
 */
public interface PushSender {

    /**
     * @return 보낸 것 가운데 <b>"등록되지 않은 기기"</b>로 답이 온 토큰. 앱을 지웠거나 알림을 꺼서 더는 받을
     *         수 없는 기기다 — 부르는 쪽이 그 토큰 행을 지운다. 없으면 빈 목록
     */
    List<String> send(List<PushMessage> messages);
}
