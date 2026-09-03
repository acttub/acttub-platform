package com.acttub.actingapi.feature.auth.schema;

import com.acttub.actingapi.platform.schema.*;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.*;
import jakarta.validation.constraints.Pattern;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name = "refresh_tokens")
public class RefreshTokenEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    UUID userId;

    @Column(name = "replaced_by_id")
    UUID replacedById;

    // bpchar 이라 JdbcTypeCode 를 함께 준다. columnDefinition 만으로는 Hibernate 가 String 을
    // VARCHAR 로 보고 ddl-auto: validate 가 CHAR 컬럼과 불일치로 죽는다 (docs/archive/soma287/M2-foundation.md B).
    @Pattern(regexp = "[0-9a-f]{64}")
    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "token_hash", nullable = false, columnDefinition = "char(64)")
    String tokenHash;

    @Column(name = "device_info")
    String deviceInfo;

    @Column(name = "issued_at", nullable = false, updatable = false)
    Instant issuedAt;

    @Column(name = "expires_at", nullable = false)
    Instant expiresAt;

    @Column(name = "revoked_at")
    Instant revokedAt;

    protected RefreshTokenEntity() {
    }

    public RefreshTokenEntity(
            UUID id,
            UUID userId,
            String tokenHash,
            String deviceInfo,
            Instant issuedAt,
            Instant expiresAt) {
        super(id);
        this.userId = userId;
        this.tokenHash = tokenHash;
        this.deviceInfo = deviceInfo;
        this.issuedAt = issuedAt;
        this.expiresAt = expiresAt;
    }

    public UUID getUserId() {
        return userId;
    }

    public UUID getReplacedById() {
        return replacedById;
    }

    public String getTokenHash() {
        return tokenHash;
    }

    public Instant getExpiresAt() {
        return expiresAt;
    }

    public Instant getRevokedAt() {
        return revokedAt;
    }

    public String getDeviceInfo() {
        return deviceInfo;
    }

    public void replaceWith(UUID replacement, Instant now) {
        replacedById = replacement;
        revokedAt = now;
    }

    public void revoke(Instant now) {
        revokedAt = now;
    }
}
