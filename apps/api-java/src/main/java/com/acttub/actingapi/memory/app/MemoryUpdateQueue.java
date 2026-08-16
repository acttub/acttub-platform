package com.acttub.actingapi.memory.app;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;

/**
 * memory 가 작업 큐에 요구하는 것 (ADR-017, SOMA-397 6단계).
 *
 * <p>큐가 실제로는 분석과 함께 쓰는 External Operation 원장이라는 사실은 구현만 안다. 워커는
 * "하나 집는다·실패로 닫는다" 둘만 알면 되고, 그래야 큐를 바꾸는 일이 워커를 건드리지 않는다.
 *
 * <p>구현은 제공하는 쪽에 있다 — {@code operation/ExternalOperationMemoryQueue}. 여기서 그 이름을
 * 적는 것은 문서일 뿐이고, memory 는 그 패키지를 import 하지 않는다.
 */
public interface MemoryUpdateQueue {

    /** 갱신 대기 중인 작업 하나를 선점한다. 집을 게 없으면 {@code null}. */
    UUID claimNext(UUID leaseToken, Duration duration, Instant now);

    /** 선점한 작업이 어느 연습의 것인지. */
    UUID practiceSessionOf(UUID operationId);

    /**
     * 작업을 성공으로 닫는다. 응답에 남는 것은 <b>어느 연습이었는지와 실제로 갱신된 칸
     * 이름들</b>이고, 그것을 어떤 키로 적을지는 원장이 정한다 — 워커는 무엇을 담을지만 안다.
     *
     * @throws LeaseOwnershipException 리스를 이미 다른 워커가 재선점했다
     */
    void complete(
            UUID operationId,
            UUID leaseToken,
            UUID practiceSessionId,
            List<String> updatedFields,
            Instant now);

    /**
     * 작업을 실패로 닫는다.
     *
     * <p><b>연습 세션 상태는 건드리지 않는다.</b> 배우 입장에서 기억은 있으면 좋은 것이지, 없다고
     * 연습이 망가질 것은 아니다 — 파이썬 {@code fail_external_operation} 의 기본값과 같다.
     *
     * @throws LeaseOwnershipException 리스를 이미 다른 워커가 재선점했다
     */
    void fail(UUID operationId, UUID leaseToken, String errorCode, Instant now);
}
