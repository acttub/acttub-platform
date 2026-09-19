package com.acttub.actingapi.feature.auth.schema;

import com.acttub.actingapi.platform.schema.*;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.*;

@Entity
@Table(name = "user_identities")
public class UserIdentityEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    UUID userId;

    @Convert(converter = IdentityProvider.JpaConverter.class)
    @Column(name = "provider", nullable = false, columnDefinition = "text")
    IdentityProvider provider;

    /** 탈퇴하면 비우고 {@link #uidHash}만 남긴다 (account.withdraw, ADR-029). */
    @Column(name = "provider_uid")
    String providerUid;

    /** 서버 비밀키로 만든 HMAC(provider, provider_uid). 탈퇴한 신원에만 있다. */
    @Column(name = "uid_hash")
    String uidHash;

    /** 로그인 때 authorization code 로 바꿔 온 애플 토큰의 암호문. 탈퇴 때 폐기 API 에 쓴다. */
    @Column(name = "apple_token_encrypted")
    String appleTokenEncrypted;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    Instant createdAt;

    protected UserIdentityEntity() {
    }

    public UserIdentityEntity(UUID id, UUID userId, IdentityProvider provider, String providerUid) {
        this(id, userId, provider, providerUid, null);
    }

    public UserIdentityEntity(
            UUID id,
            UUID userId,
            IdentityProvider provider,
            String providerUid,
            String appleTokenEncrypted) {
        super(id);
        this.userId = userId;
        this.provider = provider;
        this.providerUid = providerUid;
        this.appleTokenEncrypted = appleTokenEncrypted;
    }

    public UUID getUserId() {
        return userId;
    }
}
