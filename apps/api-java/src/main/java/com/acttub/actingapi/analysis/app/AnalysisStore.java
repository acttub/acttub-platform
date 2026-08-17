package com.acttub.actingapi.analysis.app;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface AnalysisStore {
    UUID claimNext(UUID leaseToken, Duration leaseDuration, Instant now);

    AnalysisContext getContext(UUID operationId);

    UUID complete(
            UUID operationId,
            UUID leaseToken,
            AnalysisResult result,
            String model,
            Instant now);

    boolean fail(
            UUID operationId,
            UUID leaseToken,
            String errorCode,
            Instant now);

    void release(UUID operationId, UUID leaseToken, Instant now);

    List<String> sweepExpiredUploads(Instant now);

    int sweepMaxAttempts(Instant now);
}
