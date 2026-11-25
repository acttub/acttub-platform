package com.acttub.actingapi.feature.profile.app;

import java.time.Instant;

/**
 * 매일 도는 계정 정리가 오래된 이관 코드를 치우게 하는 포트 (account.guest).
 *
 * <p>선언은 쓰는 쪽(여기)에 있고 구현은 이관 코드의 주인({@code transfer})이 한다 (ADR-017). 간선은 {@code transfer →
 * profile.app} 한 방향이다.
 */
public interface StaleTransferCodes {

    /**
     * 쓰였거나 시한이 지난 지 오래된 이관 코드 행을 지운다. ⚠ 쓰인 코드는 "이 게스트는 옮겨졌다"는 표식이라
     * 그 게스트의 리프레시 토큰이 살 수 있는 동안(30일)에는 지우면 안 된다.
     *
     * @param before 쓰인 시각(쓰이지 않았으면 시한)이 이보다 앞선 행을 지운다
     * @return 지운 행 수
     */
    int deleteStale(Instant before);
}
