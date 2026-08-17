package com.acttub.actingapi.platform.schema;
import java.time.Instant; import java.util.UUID; import com.fasterxml.jackson.databind.JsonNode; import jakarta.persistence.*; import jakarta.validation.constraints.Pattern; import org.hibernate.annotations.JdbcType; import org.hibernate.annotations.JdbcTypeCode; import org.hibernate.type.SqlTypes;
@Entity @Table(name="external_operations")
public class ExternalOperationEntity extends AppGeneratedUuidEntity {
    @Column(name="session_id",nullable=false) UUID sessionId; @Column(name="user_id",nullable=false) UUID userId; @Column(name="request_id",nullable=false) UUID requestId;
    @Convert(converter=OperationKind.JpaConverter.class) @JdbcType(PgEnumJdbcType.class) @Column(name="kind",nullable=false,columnDefinition="operation_kind_t") OperationKind kind;
    @Convert(converter=OperationStatus.JpaConverter.class) @JdbcType(PgEnumJdbcType.class) @Column(name="status",nullable=false,columnDefinition="operation_status_t") OperationStatus status;
    @Column(name="attempt_count",nullable=false) int attemptCount; @Pattern(regexp="[0-9a-f]{64}") @JdbcTypeCode(SqlTypes.CHAR) @Column(name="request_fingerprint",nullable=false,columnDefinition="char(64)") String requestFingerprint;
    @Column(name="lease_token") UUID leaseToken; @Column(name="lease_expires_at") Instant leaseExpiresAt; @Column(name="error_code") String errorCode;
    @JdbcTypeCode(SqlTypes.JSON) @Column(name="response_payload",columnDefinition="jsonb") JsonNode responsePayload;
    @Column(name="created_at",nullable=false,insertable=false,updatable=false) Instant createdAt; @Column(name="updated_at",nullable=false,insertable=false,updatable=false) Instant updatedAt;
    protected ExternalOperationEntity(){} public ExternalOperationEntity(UUID id,UUID sessionId,UUID userId,UUID requestId,OperationKind kind,OperationStatus status,String fingerprint){super(id);this.sessionId=sessionId;this.userId=userId;this.requestId=requestId;this.kind=kind;this.status=status;this.requestFingerprint=fingerprint;}
}
