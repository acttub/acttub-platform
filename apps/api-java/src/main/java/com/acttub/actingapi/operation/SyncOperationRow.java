package com.acttub.actingapi.operation;

import java.time.Instant;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 동기 멱등 처리가 {@code external_operations} 행에서 보는 것.
 *
 * <p>행의 열넷 중 여섯만 담는다 — 같은 요청인지(지문), 다시 실어 보낼 것이 있는지(상태·본문),
 * 아직 누가 쥐고 있는지(리스 토큰·만료)뿐이다. 나머지는 이 판정에 쓰이지 않는다.
 */
record SyncOperationRow(
        UUID id,
        String status,
        String requestFingerprint,
        JsonNode responsePayload,
        UUID leaseToken,
        Instant leaseExpiresAt) {
}
