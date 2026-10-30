package com.acttub.actingapi.feature.reading.app;

import java.time.Duration;

/**
 * 리딩 녹음 서버 다시 받아쓰기를 켜는 조건과 한도.
 *
 * @param enabled 꺼져 있으면 줄 세우지도 처리하지도 않는다
 * @param minPeakDb 녹음의 순간 최댓값(dBFS)이 이보다 작으면 말하지 않은 것으로 보고 모델에 보내지 않는다
 * @param dailyLimit 최근 24시간 동안 받아쓰기 모델을 부를 수 있는 최대 횟수. 넘으면 다음 주기로 미룬다
 * @param maxDurationMs 이보다 긴 녹음은 보내지 않는다(대사를 못 하고 기다린 소리가 대부분이다)
 */
public record RetranscribeSettings(
        boolean enabled, double minPeakDb, int dailyLimit, int maxDurationMs, Duration lease, int maxAttempts) {
}
