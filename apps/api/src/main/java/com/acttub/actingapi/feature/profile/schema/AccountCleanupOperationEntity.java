package com.acttub.actingapi.feature.profile.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AccountCleanupKind;
import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code account_cleanup_operations} — 탈퇴 트랜잭션 밖에서 하는 정리의 장부 (account.withdraw, V9).
 *
 * <p>끝난 것은 남지 않는다 — 성공하면 지우고, 7일이 지나면 값과 함께 지운다. {@code payloadEncrypted}
 * 는 해제에 쓸 값의 암호문이고 접두사가 어느 키로 만들었는지를 말한다. 평문을 넣지 않는다.
 *
 * <p>집고 미루는 일은 {@code FOR UPDATE SKIP LOCKED} 가 필요해 native SQL 로 한다
 * ({@code PostgresAccountCleanupRepository}). 이 Entity 는 스키마 검증과 매핑의 자리다.
 */
@Entity
@Table(name = "account_cleanup_operations")
public class AccountCleanupOperationEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Convert(converter = AccountCleanupKind.JpaConverter.class)
    @Column(name = "kind", nullable = false, columnDefinition = "text")
    private AccountCleanupKind kind;

    @Column(name = "payload_encrypted", nullable = false)
    private String payloadEncrypted;

    @Column(name = "attempt_count", nullable = false)
    private int attemptCount;

    @Column(name = "next_attempt_at", nullable = false)
    private Instant nextAttemptAt;

    @Column(name = "expires_at", nullable = false)
    private Instant expiresAt;

    @Column(name = "last_error")
    private String lastError;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected AccountCleanupOperationEntity() {
    }

    public AccountCleanupOperationEntity(
            UUID id,
            UUID userId,
            AccountCleanupKind kind,
            String payloadEncrypted,
            Instant nextAttemptAt,
            Instant expiresAt) {
        super(id);
        this.userId = userId;
        this.kind = kind;
        this.payloadEncrypted = payloadEncrypted;
        this.nextAttemptAt = nextAttemptAt;
        this.expiresAt = expiresAt;
    }

    public UUID getUserId() {
        return userId;
    }

    public AccountCleanupKind getKind() {
        return kind;
    }
}
