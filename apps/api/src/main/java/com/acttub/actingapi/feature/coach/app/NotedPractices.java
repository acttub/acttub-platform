package com.acttub.actingapi.feature.coach.app;

import java.util.UUID;

/**
 * 회차의 대화에 노트가 남았는지 다른 기능이 묻는 Port (ADR-040). 친구 초대가 「센 연습」(practice.days 와 같은 정의: 노트가 남은
 * 코칭)을 판정할 때 쓴다(SOMA-865). 잠그지 않는다.
 *
 * <p>회차의 주인은 묻지 않는다 — 회차 표는 {@code practice} 의 것이다. 부르는 쪽은 그 회차의 주인을 이미 아는 경로
 * ({@link ConversationClosedListener})에서만 부른다.
 */
public interface NotedPractices {

    /** {@code practiceId} 회차의 대화에 노트가 하나라도 있는가. */
    boolean noted(UUID practiceId);
}
