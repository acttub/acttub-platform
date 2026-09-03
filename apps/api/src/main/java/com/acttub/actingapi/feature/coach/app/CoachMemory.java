package com.acttub.actingapi.feature.coach.app;

import java.util.UUID;

/**
 * coach 가 배우의 기억에 요구하는 것.
 *
 * <p>코치는 지난 연습에서 모인 것을 알고 시작해야 같은 이야기를 다시 묻지 않는다. 그것이 어느
 * 테이블에 어떻게 쌓여 있는지는 {@code memory} 만 안다 — 여기에는 코치가 필요로 하는 세 가지만
 * 적는다.
 *
 * <p>주고받는 {@link PriorContext} 는 <b>코치의 타입</b>이다. 제공자의 타입을 시그니처에 적으면
 * "포트로 끊었다"가 이름뿐이 되고, 제공자가 이 인터페이스를 구현하는 순간 패키지 순환이 된다
 * (ADR-017).
 */
public interface CoachMemory {

    /**
     * 이번 대화 전에 이미 있던 것들 — 배우에 대해 적어 둔 것, 지난 대화 요약, 남은 숙제.
     *
     * <p>모으다 실패하는 것을 여기서 감추지 않는다. 무엇을 하고 무엇을 포기할지는 부르는 쪽의
     * 규칙이다. {@code operationId}는 손상된 저장값을 보고할 때 원장의 작업을 함께 찾기 위한 값이다.
     */
    PriorContext priorFor(UUID userId, UUID practiceSessionId, UUID operationId);

    /** 배우가 지금까지 확정한 연습의 수. 기억을 갱신할 차례인지 세는 데 쓴다. */
    long countConfirmedPractices(UUID userId);

    /**
     * 기억 갱신을 뒤에서 돌도록 큐에 넣는다.
     *
     * @return 새로 걸었으면 {@code true}. 이미 걸려 있으면 {@code false}
     */
    boolean enqueueMemoryUpdate(UUID userId, UUID practiceSessionId);
}
