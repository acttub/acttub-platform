package com.acttub.actingapi.analysis;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;

/**
 * analysis 가 작업 큐에 요구하는 것 (ADR-017, SOMA-397 6단계).
 *
 * <p>큐가 기억 갱신과 공유하는 External Operation 원장이라는 사실은 구현만 안다. 구현은 제공하는
 * 쪽에 있다 — {@code operation/ExternalOperationAnalysisQueue}.
 *
 * <p>{@link AnalysisStore} 와 나뉘어 있는 이유는 소유자다. 저쪽은 분석 산출물을 쓰는 이 도메인의
 * 저장소이고, 이쪽은 남이 관리하는 원장에 거는 요청이다.
 */
public interface AnalysisOperationQueue {

    /** 분석 대기 중인 작업 하나를 선점한다. 집을 게 없으면 {@code null}. */
    UUID claimNext(UUID leaseToken, Duration duration, Instant now);

    /**
     * 작업을 실패로 닫는다.
     *
     * <p><b>연습 세션도 함께 실패로 간다.</b> 기억 갱신과 다른 점이며, 분석이 없으면 그 연습은
     * 배우에게 보여줄 것이 없기 때문이다.
     *
     * @return 그런 작업이 없으면 거짓
     * @throws LeaseOwnershipException 리스를 이미 다른 워커가 재선점했다
     */
    boolean fail(UUID operationId, UUID leaseToken, String errorCode, Instant now);

    /**
     * 선점을 놓아 다시 대기 상태로 돌린다.
     *
     * @throws LeaseOwnershipException 리스를 이미 다른 워커가 재선점했다
     */
    void release(UUID operationId, UUID leaseToken, Instant now);

    /** 시도 횟수가 소진된 작업들을 실패로 쓸어 담는다. 쓸어 담은 수. */
    int sweepMaxAttempts(Instant now);
}
