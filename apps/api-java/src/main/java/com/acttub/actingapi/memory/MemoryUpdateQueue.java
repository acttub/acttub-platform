package com.acttub.actingapi.memory;

import java.time.Duration;
import java.time.Instant;
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
