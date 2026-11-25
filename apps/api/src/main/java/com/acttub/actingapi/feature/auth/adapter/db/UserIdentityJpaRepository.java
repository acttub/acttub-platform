package com.acttub.actingapi.feature.auth.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.schema.UserIdentityEntity;
import com.acttub.actingapi.platform.schema.IdentityProvider;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

interface UserIdentityJpaRepository extends JpaRepository<UserIdentityEntity, UUID> {

    Optional<UserIdentityEntity> findByProviderAndProviderUid(
            IdentityProvider provider,
            String providerUid);

    /** uid 가 있는 신원의 제공자를 마지막 사용이 늦은 것부터(같으면 이름순) 하나씩. */
    @Query("""
            select i.provider from UserIdentityEntity i
            where i.userId = :userId and i.providerUid is not null
            group by i.provider
            order by max(i.lastUsedAt) desc, i.provider
            """)
    List<IdentityProvider> providersOf(@Param("userId") UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update UserIdentityEntity i set i.lastUsedAt = :now
            where i.provider = :provider and i.providerUid = :providerUid
            """)
    int markUsed(@Param("provider") IdentityProvider provider, @Param("providerUid") String providerUid,
            @Param("now") Instant now);

    /** 같은 신원({@code uq_user_identities_provider_uid})이 있으면 0 이다. 토큰 칸은 제공자마다 따로다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into UserIdentityEntity (id, userId, provider, providerUid, appleTokenEncrypted, naverTokenEncrypted)
            values (:id, :userId, :provider, :providerUid, :appleToken, :naverToken)
            on conflict (provider, providerUid) do nothing
            """)
    int link(@Param("id") UUID id, @Param("userId") UUID userId, @Param("provider") IdentityProvider provider,
            @Param("providerUid") String providerUid, @Param("appleToken") String appleToken,
            @Param("naverToken") String naverToken);

    boolean existsByProviderAndProviderUidAndAppleTokenEncryptedIsNull(IdentityProvider provider, String providerUid);

    boolean existsByProviderAndProviderUidAndNaverTokenEncryptedIsNull(IdentityProvider provider, String providerUid);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update UserIdentityEntity i set i.appleTokenEncrypted = :token
            where i.provider = :provider and i.providerUid = :providerUid
            """)
    int storeAppleToken(@Param("provider") IdentityProvider provider, @Param("providerUid") String providerUid,
            @Param("token") String token);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update UserIdentityEntity i set i.naverTokenEncrypted = :token
            where i.provider = :provider and i.providerUid = :providerUid
            """)
    int storeNaverToken(@Param("provider") IdentityProvider provider, @Param("providerUid") String providerUid,
            @Param("token") String token);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from UserIdentityEntity i where i.provider = :provider and i.providerUid = :providerUid")
    int remove(@Param("provider") IdentityProvider provider, @Param("providerUid") String providerUid);

    /** 옮겨진 게스트의 신원을 지운다. 자기 트랜잭션을 열지 않는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from UserIdentityEntity i where i.userId = :userId")
    int removeAllOf(@Param("userId") UUID userId);
}
