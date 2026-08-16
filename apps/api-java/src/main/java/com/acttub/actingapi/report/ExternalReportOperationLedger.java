package com.acttub.actingapi.report;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.operation.SyncOperationBegin;
import com.acttub.actingapi.operation.SyncOperationClaim;
import com.acttub.actingapi.operation.SyncOperationService;
import com.fasterxml.jackson.databind.JsonNode;
import org.springframework.stereotype.Component;

/** {@link ReportOperationLedger} 를 공용 External Operation 원장 위에 얹는다. */
@Component
class ExternalReportOperationLedger implements ReportOperationLedger {

    private final SyncOperationService sync;

    ExternalReportOperationLedger(SyncOperationService sync) {
        this.sync = sync;
    }

    @Override
    public UUID requestId(String header) {
        return sync.requestId(header);
    }

    @Override
    public String fingerprint(String kind, Object payload) {
        return sync.fingerprint(kind, payload);
    }

    @Override
    public SyncOperationBegin begin(
            UUID userId,
            UUID practiceSessionId,
            UUID requestId,
            String operationKind,
            String requestFingerprint) {
        return sync.begin(userId, practiceSessionId, requestId, operationKind, requestFingerprint);
    }

    @Override
    public void complete(SyncOperationClaim claim, JsonNode responsePayload) {
        sync.complete(claim, responsePayload);
    }

    @Override
    public void fail(SyncOperationClaim claim, String errorCode) {
        sync.fail(claim, errorCode);
    }

    @Override
    public Instant now() {
        return sync.now();
    }
}
