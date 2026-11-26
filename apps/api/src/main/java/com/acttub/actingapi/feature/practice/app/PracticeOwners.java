package com.acttub.actingapi.feature.practice.app;

import java.util.UUID;

/**
 * 회차의 주인을 다른 기능이 묻는 자리 (ADR-040). 회차의 테이블은 {@code practice} 의 것이라 다른 기능은 이 Port 로 묻는다.
 */
public interface PracticeOwners {

    /** 그 회차가 이 사람의 것인가. 없는 회차면 거짓이다. */
    boolean owns(UUID userId, UUID practiceId);
}
