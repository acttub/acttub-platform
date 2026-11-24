package com.acttub.actingapi.feature.analysis.app;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.platform.ledger.ExternalOperationExecution;

public interface AnalysisStore {
    ExternalOperationExecution execution(UUID operationId, UUID leaseToken);

    UUID claimNext(UUID leaseToken, Duration leaseDuration, Instant now);

    AnalysisContext getContext(UUID operationId);

    /** @return 저장한 결과의 id. 작업이 이미 닫혔거나 계정이 탈퇴해 저장하지 않았으면 {@code null} — 완료를 알리지 않는다 */
    UUID complete(
            UUID operationId,
            UUID leaseToken,
            AnalysisResult result,
            String model,
            Instant now);


    int sweepMaxAttempts(Instant now);
    boolean fail(UUID operationId, UUID leaseToken, String errorCode, String classification, Instant now);

    void release(UUID operationId, UUID leaseToken, String classification, Instant now);

}
