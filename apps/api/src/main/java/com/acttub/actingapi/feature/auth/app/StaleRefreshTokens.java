package com.acttub.actingapi.feature.auth.app;

import java.time.Instant;

/**
 * 매일 도는 계정 정리가 오래된 리프레시 토큰을 치우게 한다 (account.login).
 *
 * <p>만료되거나 폐기된 토큰 행은 한동안 남겨 소진된 토큰의 재사용 탐지와 문제 추적에 쓴다. 그 기간이 지난 행을 지운다.
 */
public interface StaleRefreshTokens {

    /**
     * 자기 트랜잭션에서 한 문장으로 지운다.
     *
     * @param before 시한이나 폐기 시각이 이보다 앞선 행을 지운다
     * @return 지운 행 수
     */
    int deleteStale(Instant before);
}
