package com.acttub.actingapi.operation;

import java.util.UUID;

public record SyncOperationClaim(UUID operationId, UUID leaseToken, UUID requestId) {
}
