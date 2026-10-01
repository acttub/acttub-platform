package com.acttub.actingapi.feature.coach.app;

import java.util.UUID;

/**
 * coach 가 배우의 기억에 요구하는 것.
 *
 * <p>코치는 지난 연습에서 모인 것을 알고 시작해야 같은 이야기를 다시 묻지 않는다. 그것이 어느
 * 테이블에 어떻게 쌓여 있는지는 {@code memory} 만 안다 — 여기에는 코치가 필요로 하는 것만 적는다.
 *
 * <p>주고받는 {@link PriorContext} 는 <b>코치의 타입</b>이다. 제공자의 타입을 시그니처에 적으면
 * "포트로 끊었다"가 이름뿐이 되고, 제공자가 이 인터페이스를 구현하는 순간 패키지 순환이 된다
 * (ADR-017).
 */
public interface CoachMemory {

    /** 0.1.0 회차의 기억·앞 회차 맥락. 옛 대화의 테이블 존재 여부로 경로를 추측하지 않는다. */
    PriorContext priorForPractice(UUID userId, UUID practiceId, UUID operationId);
}
