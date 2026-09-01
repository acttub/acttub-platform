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

    @Column(name = "provider_uid", nullable = false)
    String providerUid;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    Instant createdAt;

    protected UserIdentityEntity() {
    }

    public UserIdentityEntity(UUID id, UUID userId, IdentityProvider provider, String providerUid) {
        super(id);
        this.userId = userId;
        this.provider = provider;
        this.providerUid = providerUid;
    }

    public UUID getUserId() {
        return userId;
    }
}
