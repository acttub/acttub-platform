package com.acttub.actingapi.operation;

import java.time.Instant;
import java.util.UUID;

/** 저장 계층에서 반환하는 {@code practice_sessions} 스냅샷. */
public record PracticeSessionRow(
        UUID id,
        UUID userId,
        UUID uploadIntentId,
        String status,
        String situation,
        String characterContext,
        String goal,
        String subtext,
        String blockageKind,
        String subBranch,
        String blockageDetail,
        Instant hiddenAt,
        Instant createdAt,
        Instant updatedAt) {
}
