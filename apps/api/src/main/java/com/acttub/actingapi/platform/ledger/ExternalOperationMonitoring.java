package com.acttub.actingapi.platform.ledger;

import java.time.Instant;
import java.util.UUID;
/** Observations of successful ledger transitions, registered inside their transaction. */
public interface ExternalOperationMonitoring {
    void accepted(String kind);

    void terminal(Terminal terminal);

    void claimed(Claimed claimed);

    void requeued(UUID operationId, String kind);

    ExternalOperationExecution execution(UUID operationId, UUID leaseToken);

    /** Immutable values captured by the successful transition, never re-read after commit. */
    record Terminal(UUID operationId, String kind, String outcome, String classification, Instant createdAt) { }

    record Claimed(String kind, Instant waitingSince, int attemptCount, Instant claimedAt) { }
}
