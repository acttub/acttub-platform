package com.acttub.actingapi.feature.push.app;

/**
 * 알림을 받을 단말 하나. 토큰과 그 단말이 쓰는 말이다 (SOMA-544).
 *
 * <p>알림을 보내는 자리는 예약 작업이라 요청이 없다 — 받는 사람이 어느 말을 쓰는지 그때
 * 알아낼 방법이 없어, 앱이 토큰을 맡길 때(그때는 요청이다) 함께 적어 둔 값을 읽는다.
 */
public record PushTarget(String token, String locale) {
}
