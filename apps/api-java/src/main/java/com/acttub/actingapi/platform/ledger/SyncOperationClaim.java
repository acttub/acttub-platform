package com.acttub.actingapi.platform.ledger;

import java.util.UUID;

public record SyncOperationClaim(UUID operationId, UUID leaseToken, UUID requestId) {
}
