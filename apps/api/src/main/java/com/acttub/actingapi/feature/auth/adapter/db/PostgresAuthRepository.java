package com.acttub.actingapi.feature.auth.adapter.db;

import static com.acttub.actingapi.platform.schema.NativeTuples.list;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AuthRepository;
import com.acttub.actingapi.feature.auth.app.IdentityAlreadyLinkedError;
import com.acttub.actingapi.feature.auth.domain.RefreshToken;
import com.acttub.actingapi.feature.auth.schema.RefreshTokenEntity;
import com.acttub.actingapi.feature.auth.schema.UserEntity;
import com.acttub.actingapi.feature.auth.schema.UserIdentityEntity;
import com.acttub.actingapi.platform.schema.IdentityProvider;
import com.acttub.actingapi.platform.schema.UserStatus;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.security.AuthenticatedUsers;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 사용자를 소유한 쪽이 배관의 포트를 <b>직접</b> 구현한다 — 위임만 하는 어댑터를 끼우지
 * 않는다 (ADR-017, SOMA-397 6단계의 {@code SyncOperationService} 와 같은 형태).
 *
 * <p>동의 여부는 여기 없다. 동의 문서와 그 이력을 소유한 쪽은 {@code consent} 이고, 게이트가
 * 묻는 것({@code PendingConsentGate})도 로그인 응답에 실리는 목록({@code auth/app/
 * PendingConsentDocuments})도 그쪽이 답한다 (SOMA-397 12단계).
 */
@Repository
public class PostgresAuthRepository implements AuthRepository, AuthenticatedUsers {
    private final UserJpaRepository users;
    private final UserIdentityJpaRepository identities;
    private final RefreshTokenJpaRepository refreshTokens;
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    public PostgresAuthRepository(
            UserJpaRepository users,
            UserIdentityJpaRepository identities,
            RefreshTokenJpaRepository refreshTokens,
            EntityManager entityManager,
            PlatformTransactionManager transactionManager) {
        this.users = users;
        this.identities = identities;
        this.refreshTokens = refreshTokens;
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public AuthenticatedUser find(UUID id) {
        return users.findAuthenticatedById(id)
                .map(PostgresAuthRepository::authenticated)
                .orElse(null);
    }

    @Override
    public AuthenticatedUser findByEmail(String email) {
        return users.findAuthenticatedByEmail(email)
                .map(PostgresAuthRepository::authenticated)
                .orElse(null);
    }

    @Override
    public AuthenticatedUser findByIdentity(String provider, String uid) {
        return users.findAuthenticatedByIdentity(provider(provider), uid)
                .map(PostgresAuthRepository::authenticated)
                .orElse(null);
    }

    @Override
    public AuthenticatedUser createUserWithIdentity(
            String provider,
            String uid,
            String email) {
        return transaction.execute(status -> {
            UserEntity user = users.save(new UserEntity(
                    UUID.randomUUID(), email, UserStatus.ACTIVE, null));
            identities.saveAndFlush(new UserIdentityEntity(
                    UUID.randomUUID(),
                    user.getId(),
                    provider(provider),
                    uid));
            return authenticated(user);
        });
    }

    @Override
    public void linkIdentity(UUID user, String provider, String uid) {
        IdentityProvider identityProvider = provider(provider);
        transaction.executeWithoutResult(status -> {
            List<Tuple> inserted = list(entityManager.createNativeQuery("""
                    WITH linked AS (
                        INSERT INTO user_identities(id,user_id,provider,provider_uid)
                        VALUES (:id,:userId,:provider,:providerUid)
                        ON CONFLICT(provider,provider_uid) DO NOTHING
                        RETURNING user_id
                    )
                    SELECT user_id FROM linked
                    """, Tuple.class)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("userId", user)
                    .setParameter("provider", identityProvider.dbValue())
                    .setParameter("providerUid", uid));
            if (!inserted.isEmpty()) {
                return;
            }
            UUID owner = identities.findByProviderAndProviderUid(identityProvider, uid)
                    .map(UserIdentityEntity::getUserId)
                    .orElse(null);
            if (!user.equals(owner)) {
                throw new IdentityAlreadyLinkedError(
                        "identity is already linked to another user");
            }
        });
    }

    @Override
    public void issueRefresh(
            UUID user,
            String hash,
            Instant expires,
            String device,
            Instant issued) {
        validateHash(hash);
        transaction.executeWithoutResult(status -> refreshTokens.saveAndFlush(
                new RefreshTokenEntity(
                        UUID.randomUUID(), user, hash, device, issued, expires)));
    }

    @Override
    public RefreshToken getRefresh(String hash) {
        validateHash(hash);
        return refreshTokens.findByTokenHash(hash)
                .map(PostgresAuthRepository::refresh)
                .orElse(null);
    }

    /**
     * 판정과 교체가 한 트랜잭션·한 잠금 안에서 난다. 무엇이 재사용이고 무엇이 만료인지는
     * {@link RefreshToken} 이 정하고, 여기서는 {@code FOR UPDATE} 로 잡은 채 그것을 묻는다.
     */
    @Override
    public Rotation rotate(
            String oldHash,
            String newHash,
            Instant expires,
            String device,
            Instant now) {
        validateHash(oldHash);
        validateHash(newHash);
        return transaction.execute(status -> {
            RefreshTokenEntity oldEntity = refreshTokens.findByTokenHashForUpdate(oldHash)
                    .orElse(null);
            if (oldEntity == null) {
                return new Rotation(null, false);
            }
            RefreshToken old = refresh(oldEntity);
            if (old.reused()) {
                refreshTokens.revokeAllActiveByUserId(old.userId(), now);
                return new Rotation(null, true);
            }
            if (old.revoked() || old.expiredAt(now)) {
                if (!old.revoked()) {
                    oldEntity.revoke(now);
                }
                return new Rotation(null, false);
            }

            UUID replacement = UUID.randomUUID();
            refreshTokens.saveAndFlush(new RefreshTokenEntity(
                    replacement,
                    old.userId(),
                    newHash,
                    device != null ? device : old.deviceInfo(),
                    now,
                    expires));
            oldEntity.replaceWith(replacement, now);
            return new Rotation(replacement, false);
        });
    }

    @Override
    public boolean revoke(String hash, Instant now) {
        validateHash(hash);
        return Boolean.TRUE.equals(transaction.execute(
                status -> refreshTokens.revokeActiveByTokenHash(hash, now) > 0));
    }

    private static AuthenticatedUser authenticated(UserEntity entity) {
        return new AuthenticatedUser(
                entity.getId(), entity.getEmail(), entity.getStatus());
    }

    private static AuthenticatedUser authenticated(
            UserJpaRepository.AuthenticatedUserProjection projection) {
        return new AuthenticatedUser(
                projection.getId(), projection.getEmail(), projection.getStatus());
    }

    private static RefreshToken refresh(RefreshTokenEntity entity) {
        return new RefreshToken(
                entity.getId(),
                entity.getUserId(),
                entity.getReplacedById(),
                entity.getExpiresAt(),
                entity.getRevokedAt(),
                entity.getDeviceInfo());
    }

    private static IdentityProvider provider(String raw) {
        return IdentityProvider.valueOf(raw.toUpperCase(Locale.ROOT));
    }

    private static void validateHash(String value) {
        if (value == null || !value.matches("[0-9a-f]{64}")) {
            throw new IllegalArgumentException("expected SHA-256 hex");
        }
    }
}
