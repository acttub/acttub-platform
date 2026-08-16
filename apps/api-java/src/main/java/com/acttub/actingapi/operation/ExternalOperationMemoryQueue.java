package com.acttub.actingapi.operation;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.memory.MemoryUpdateQueue;
import org.springframework.stereotype.Component;

/**
 * memory 가 선언한 {@link MemoryUpdateQueue} 를 분석과 공용으로 쓰는 External Operation 원장으로
 * 채운다 (ADR-017, SOMA-397 6단계).
 *
 * <p><b>원장 쪽에 산다.</b> 쓰는 쪽이 무엇을 요구하는지 선언하고 제공하는 쪽이 그것을 구현하므로,
 * memory 는 이 클래스도 {@link ExternalOperationClaimer} 도 모른다.
 *
 * <p>작업 종류 문자열과 "연습을 실패시키지 않는다"는 선택이 여기서 고정된다. 워커는 호출할
 * 때마다 그 둘을 다시 정하지 않는다.
 */
@Component
class ExternalOperationMemoryQueue implements MemoryUpdateQueue {

    /** 원장의 작업 종류. {@code operation_kind_t} 의 값이며 파이썬과 같다. */
    private static final String KIND = "memory_update";

    private final ExternalOperationClaimer claimer;

    ExternalOperationMemoryQueue(ExternalOperationClaimer claimer) {
        this.claimer = claimer;
    }

    @Override
    public UUID claimNext(UUID leaseToken, Duration duration, Instant now) {
        return claimer.claimNext(KIND, leaseToken, duration, now);
    }

    @Override
    public void fail(UUID operationId, UUID leaseToken, String errorCode, Instant now) {
        claimer.fail(operationId, leaseToken, errorCode, false, now);
    }
}
