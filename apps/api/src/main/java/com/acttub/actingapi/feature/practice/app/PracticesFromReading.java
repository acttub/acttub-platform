package com.acttub.actingapi.feature.practice.app;

import java.util.UUID;

/**
 * 리딩 회차로 시작한 코칭 회차를 리딩이 묻는 자리 (reading.voice-coaching, ADR-040). 회차의 테이블은 {@code practice} 의 것이라
 * 리딩은 이 Port 로 묻는다.
 */
public interface PracticesFromReading {

    /** 그 리딩 회차로 시작한 내 코칭 회차 id. 없으면 {@code null}. */
    UUID practiceOf(UUID userId, UUID readingSessionId);

    /**
     * 코칭 회차가 시작한 리딩 회차 id. 영상으로 이은 회차도 묶음 첫 회차의 리딩 회차를 가리킨다. 내 회차가 아니거나 리딩으로 시작하지
     * 않았으면 {@code null}.
     */
    UUID readingSessionOf(UUID userId, UUID practiceId);
}
