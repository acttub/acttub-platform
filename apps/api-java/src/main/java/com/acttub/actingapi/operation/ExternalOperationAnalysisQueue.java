package com.acttub.actingapi.operation;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.analysis.AnalysisOperationQueue;
import org.springframework.stereotype.Component;

/**
 * analysis 가 선언한 {@link AnalysisOperationQueue} 를 External Operation 원장으로 채운다
 * (ADR-017, SOMA-397 6단계).
 *
 * <p>{@link ExternalOperationMemoryQueue} 와 같은 원장을 다른 종류로 쓴다. 갈리는 지점은 둘이다 —
 * 작업 종류와, 실패할 때 연습 세션까지 실패로 보낼지. 분석은 보낸다.
 */
@Component
class ExternalOperationAnalysisQueue implements AnalysisOperationQueue {

    /** 원장의 작업 종류. {@code operation_kind_t} 의 값이며 파이썬과 같다. */
    private static final String KIND = "analyze";

    private final ExternalOperationClaimer claimer;

    ExternalOperationAnalysisQueue(ExternalOperationClaimer claimer) {
        this.claimer = claimer;
    }

    @Override
    public UUID claimNext(UUID leaseToken, Duration duration, Instant now) {
        return claimer.claimNext(KIND, leaseToken, duration, now);
    }

    @Override
    public boolean fail(UUID operationId, UUID leaseToken, String errorCode, Instant now) {
        return claimer.fail(operationId, leaseToken, errorCode, true, now);
    }

    @Override
    public void release(UUID operationId, UUID leaseToken, Instant now) {
        claimer.release(operationId, leaseToken, now);
    }

    @Override
    public int sweepMaxAttempts(Instant now) {
        return claimer.sweepMaxAttempts(now);
    }
}
