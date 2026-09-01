package com.acttub.actingapi.feature.auth.adapter.db;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.schema.UserIdentityEntity;
import com.acttub.actingapi.platform.schema.IdentityProvider;
import org.springframework.data.jpa.repository.JpaRepository;

interface UserIdentityJpaRepository extends JpaRepository<UserIdentityEntity, UUID> {

    Optional<UserIdentityEntity> findByProviderAndProviderUid(
            IdentityProvider provider,
            String providerUid);
}
