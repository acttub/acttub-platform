package com.acttub.actingapi.auth.domain;

import java.time.Instant;
import java.util.UUID;

/**
 * 저장돼 있는 refresh 토큰 하나. CONTEXT.md 가 말하는 Domain Model 이며
 * {@code refresh_tokens} 행을 옮겨 담는다.
 *
 * <p>회전의 판정이 여기 산다. 판정을 <b>부르는 자리</b>는 저장소의 트랜잭션 안이다 —
 * {@code FOR UPDATE} 로 행을 잡은 채 갈라야 두 요청이 같은 토큰을 함께 회전시키지 못한다.
 * 그 경계는 SQL 이 지키고, 무엇을 어떻게 부를지는 여기가 정한다.
 */
public record RefreshToken(
        UUID id,
        UUID userId,
        UUID replacedById,
        Instant expiresAt,
        Instant revokedAt,
        String deviceInfo) {

    /**
     * 이미 한 번 대체된 토큰이 다시 왔는가.
     *
     * <p><b>도난으로 본다.</b> 정상 클라이언트는 회전된 토큰을 다시 쓰지 않으므로, 이 자리에
     * 닿았다는 것은 누군가 옛 토큰을 쥐고 있다는 뜻이다 — 그 계정의 살아 있는 토큰을 전부 끊는다.
     */
    public boolean reused() {
        return replacedById != null;
    }

    public boolean revoked() {
        return revokedAt != null;
    }

    /** 경계는 배타다 — 만료 시각과 정확히 같은 순간은 이미 못 쓴다. */
    public boolean expiredAt(Instant now) {
        return !expiresAt.isAfter(now);
    }
}
