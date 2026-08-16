package com.acttub.actingapi.memory;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.operation.ExternalOperationClaimer;
import org.springframework.stereotype.Component;

/**
 * {@link MemoryUpdateQueue} 를 분석과 공용으로 쓰는 External Operation 원장 위에 얹는다.
 *
 * <p><b>memory 에서 원장을 아는 자리는 여기 하나다.</b> 작업 종류 문자열과 "연습을 실패시키지
 * 않는다"는 선택이 이 클래스에서 고정되고, 워커는 호출할 때마다 그 둘을 다시 정하지 않는다.
 */
@Component
class ExternalMemoryUpdateQueue implements MemoryUpdateQueue {

    /** 원장의 작업 종류. {@code operation_kind_t} 의 값이며 파이썬과 같다. */
    private static final String KIND = "memory_update";

    private final ExternalOperationClaimer claimer;

    ExternalMemoryUpdateQueue(ExternalOperationClaimer claimer) {
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
