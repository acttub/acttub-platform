package com.acttub.actingapi.feature.auth.adapter.db;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.schema.UserEntity;
import com.acttub.actingapi.platform.schema.IdentityProvider;
import com.acttub.actingapi.platform.schema.UserStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface UserJpaRepository extends JpaRepository<UserEntity, UUID> {

    @Query("""
            SELECT user.id AS id,user.email AS email,user.status AS status
            FROM UserEntity user
            WHERE user.id=:id
            """)
    Optional<AuthenticatedUserProjection> findAuthenticatedById(@Param("id") UUID id);

    @Query("""
            SELECT user.id AS id,user.email AS email,user.status AS status
            FROM UserEntity user
            WHERE lower(user.email)=lower(:email)
            """)
    Optional<AuthenticatedUserProjection> findAuthenticatedByEmail(
            @Param("email") String email);

    @Query("""
            SELECT user.id AS id,user.email AS email,user.status AS status
            FROM UserEntity user,UserIdentityEntity identity
            WHERE identity.userId=user.id
              AND identity.provider=:provider
              AND identity.providerUid=:providerUid
            """)
    Optional<AuthenticatedUserProjection> findAuthenticatedByIdentity(
            @Param("provider") IdentityProvider provider,
            @Param("providerUid") String providerUid);

    interface AuthenticatedUserProjection {
        UUID getId();

        String getEmail();

        UserStatus getStatus();
    }
}
