package com.acttub.actingapi.platform.operation.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * {@code ai_jobs}(V14) — 뒤에서 도는 AI 작업 한 건과 그 lease(apps/api/CONTRACT.md §5-7).
 *
 * <p>종류·상태 칸은 문자열 그대로 둔다. 허용 값은 DB 의 CHECK 가 지키고, 상태를 바꾸는 문장은 값을 글자로 적어 어느 길로
 * 넘어가는지 문장에서 읽히게 한다({@code StateTransitionTest}). 읽고 쓰는 문장은 {@code PostgresAiJobLedger} 한 파일에 있다.
 * 이 매핑은 표의 주인(platform/operation) 안에 둔다 — 다른 패키지에 두면 주인 밖에서 쓰는 자리가 하나 는다({@code TableOwnerTest}).
 */
@Entity
@Table(name = "ai_jobs")
public class AiJobEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "kind", nullable = false)
    private String kind;

    @Column(name = "target_id", nullable = false)
    private UUID targetId;

    @Column(name = "request_id", nullable = false)
    private UUID requestId;

    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "request_fingerprint", nullable = false, columnDefinition = "char(64)")
    private String requestFingerprint;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "attempt_count", nullable = false)
    private int attemptCount;

    @Column(name = "lease_token")
    private UUID leaseToken;

    @Column(name = "lease_expires_at")
    private Instant leaseExpiresAt;

    @Column(name = "failure_reason")
    private String failureReason;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "result", columnDefinition = "jsonb")
    private String result;

    @Column(name = "memory_epoch")
    private Integer memoryEpoch;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected AiJobEntity() {
    }

    public AiJobEntity(UUID id, UUID userId, String kind, UUID targetId, UUID requestId, String requestFingerprint,
            Instant createdAt) {
        super(id);
        this.userId = userId;
        this.kind = kind;
        this.targetId = targetId;
        this.requestId = requestId;
        this.requestFingerprint = requestFingerprint;
        this.status = "pending";
        this.createdAt = createdAt;
        this.updatedAt = createdAt;
    }
}
