package com.acttub.actingapi.feature.reading.app;

import java.util.UUID;

/**
 * 리딩 회차가 그 사람의 완료한 회차인지 다른 기능이 묻는 Port (ADR-040). 친구 초대가 「센 연습」(practice.days 와 같은 정의)을
 * 판정할 때 쓴다(SOMA-865). 잠그지 않는다.
 */
public interface CompletedReadings {

    /** {@code sessionId} 가 {@code userId} 의 회차이고 완료 상태인가. */
    boolean completed(UUID userId, UUID sessionId);
}
