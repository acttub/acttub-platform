package com.acttub.actingapi.feature.analysis.app;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.ledger.ExternalOperationExecution;
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
    ExternalOperationExecution execution(UUID operationId, UUID leaseToken);


    /** 분석 대기 중인 작업 하나를 선점한다. 집을 게 없으면 {@code null}. */
    UUID claimNext(UUID leaseToken, Duration duration, Instant now);

    /** 시도 횟수가 소진된 작업들을 실패로 쓸어 담는다. 쓸어 담은 수. */
    int sweepMaxAttempts(Instant now);
    boolean fail(UUID operationId, UUID leaseToken, String errorCode, String classification, Instant now);

    void release(UUID operationId, UUID leaseToken, String classification, Instant now);

}
