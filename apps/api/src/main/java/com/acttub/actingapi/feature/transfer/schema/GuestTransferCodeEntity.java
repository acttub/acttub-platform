package com.acttub.actingapi.feature.transfer.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code guest_transfer_codes} — 웹 게스트의 자료를 앱 회원에게 옮기는 여섯 자리 코드 (ADR-028).
 *
 * <p>코드는 해시로만 저장한다. {@code user_id} 는 코드를 받은 <b>게스트</b>다. 10분·1회용이고
 * 새로 받으면 이전 코드는 무효다 — 그 규칙은 DB 가 아니라 애플리케이션이 지킨다.
 */
@Entity
@Table(name = "guest_transfer_codes")
public class GuestTransferCodeEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "code_hash", nullable = false)
    private String codeHash;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "used_at")
    private Instant usedAt;

    protected GuestTransferCodeEntity() {
    }

    public GuestTransferCodeEntity(UUID id, UUID userId, String codeHash, Instant expiresAt) {
        super(id);
        this.userId = userId;
        this.codeHash = codeHash;
        this.expiresAt = expiresAt;
    }

    public UUID getUserId() {
        return userId;
    }

    public String getCodeHash() {
        return codeHash;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getUsedAt() {
        return usedAt;
    }
}
