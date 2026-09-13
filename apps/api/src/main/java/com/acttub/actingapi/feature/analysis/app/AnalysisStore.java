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

    UUID complete(
            UUID operationId,
            UUID leaseToken,
            AnalysisResult result,
            String model,
            Instant now);

    default boolean fail(UUID operationId, UUID leaseToken, String errorCode, Instant now) {
        return fail(operationId, leaseToken, errorCode, null, now);
    }

    default void release(UUID operationId, UUID leaseToken, Instant now) {
        release(operationId, leaseToken, null, now);
    }

    List<String> sweepExpiredUploads(Instant now);

    int sweepMaxAttempts(Instant now);
    boolean fail(UUID operationId, UUID leaseToken, String errorCode, String classification, Instant now);

    void release(UUID operationId, UUID leaseToken, String classification, Instant now);

}
