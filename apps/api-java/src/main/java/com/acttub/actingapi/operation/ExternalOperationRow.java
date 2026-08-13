package com.acttub.actingapi.operation;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

/** 저장 계층에서 반환하는 {@code external_operations} 스냅샷. */
public record ExternalOperationRow(
        UUID id,
        UUID sessionId,
        UUID userId,
        UUID requestId,
        String kind,
        String status,
        int attemptCount,
        String requestFingerprint,
        UUID leaseToken,
        Instant leaseExpiresAt,
        String errorCode,
        JsonNode responsePayload,
        Instant createdAt,
        Instant updatedAt) {
}
