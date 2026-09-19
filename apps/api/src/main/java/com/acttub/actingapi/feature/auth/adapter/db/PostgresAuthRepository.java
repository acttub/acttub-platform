package com.acttub.actingapi.feature.auth.adapter.db;

import static com.acttub.actingapi.platform.persistence.NativeTuples.list;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AcceptedConsent;
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
    public AuthenticatedUser createAccount(
            String provider,
            String uid,
            String email,
            String providerTokenEncrypted,
            List<AcceptedConsent> consents,
            Instant now) {
        return transaction.execute(status -> {
            UserEntity user = users.save(new UserEntity(
                    UUID.randomUUID(), email, UserStatus.ACTIVE));
            identities.saveAndFlush(new UserIdentityEntity(
                    UUID.randomUUID(),
                    user.getId(),
                    provider(provider),
                    uid,
                    providerTokenEncrypted));
            // ⚠ `user_consents` 의 주인은 `consent` 다. 그래도 여기서 쓰는 것은 계정과 동의가 한
            // 트랜잭션이어야 하기 때문이다. 다른 feature 의 Schema Entity 를 import 하면 패키지
            // 경계를 우회하므로 명시적 native DML 로 남긴다(탈퇴의 교차 도메인 정리와 같은 형태).
            // 무엇을 받아도 되는지는 이미 `consent` 가 확인했다(`PendingConsentDocuments`).
            for (AcceptedConsent consent : consents) {
                entityManager.createNativeQuery("""
                        INSERT INTO user_consents(id,user_id,document_id,action,occurred_at)
                        VALUES (:id,:userId,:documentId,:action,:occurredAt)
                        """)
                        .setParameter("id", UUID.randomUUID())
                        .setParameter("userId", user.getId())
                        .setParameter("documentId", consent.documentId())
                        .setParameter("action", consent.action())
                        .setParameter("occurredAt", now.atOffset(ZoneOffset.UTC))
                        .executeUpdate();
            }
            return authenticated(user);
        });
    }

    @Override
    public List<String> providersOf(UUID userId) {
        return list(entityManager.createNativeQuery("""
                SELECT DISTINCT provider
                FROM user_identities
                WHERE user_id=:userId
                  AND provider_uid IS NOT NULL
                ORDER BY provider
                """, Tuple.class)
                .setParameter("userId", userId)).stream()
                .map(row -> provider(row.get("provider", String.class)).dbValue())
                .toList();
    }

    @Override
    public void updateEmailIfFree(UUID userId, String email) {
        transaction.executeWithoutResult(status -> entityManager.createNativeQuery("""
                UPDATE users
                SET email=:email,updated_at=now()
                WHERE id=:userId
                  AND NOT EXISTS (SELECT 1 FROM users taken WHERE lower(taken.email)=lower(:email))
                """)
                .setParameter("email", email)
                .setParameter("userId", userId)
                .executeUpdate());
    }

    @Override
    public void linkIdentity(UUID user, String provider, String uid, String providerTokenEncrypted) {
        IdentityProvider identityProvider = provider(provider);
        transaction.executeWithoutResult(status -> {
            // 토큰 칸은 제공자마다 따로다. 없는 값은 NULL 이라 타입을 추론하지 못해 CAST 한다.
            List<Tuple> inserted = list(entityManager.createNativeQuery("""
                    WITH linked AS (
                        INSERT INTO user_identities(
                            id,user_id,provider,provider_uid,apple_token_encrypted,naver_token_encrypted)
                        VALUES (:id,:userId,:provider,:providerUid,
                                CAST(:appleToken AS text),CAST(:naverToken AS text))
                        ON CONFLICT(provider,provider_uid) DO NOTHING
                        RETURNING user_id
                    )
                    SELECT user_id FROM linked
                    """, Tuple.class)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("userId", user)
                    .setParameter("provider", identityProvider.dbValue())
                    .setParameter("providerUid", uid)
                    .setParameter("appleToken",
                            identityProvider == IdentityProvider.APPLE ? providerTokenEncrypted : null)
                    .setParameter("naverToken",
                            identityProvider == IdentityProvider.NAVER ? providerTokenEncrypted : null));
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
    public boolean lacksProviderToken(String provider, String uid) {
        String column = tokenColumn(provider(provider));
        if (column == null) {
            return false;
        }
        return !list(entityManager.createNativeQuery(
                "SELECT 1 AS missing FROM user_identities"
                        + " WHERE provider=:provider AND provider_uid=:providerUid AND " + column + " IS NULL",
                Tuple.class)
                .setParameter("provider", provider(provider).dbValue())
                .setParameter("providerUid", uid)).isEmpty();
    }

    @Override
    public void storeProviderToken(String provider, String uid, String providerTokenEncrypted) {
        String column = tokenColumn(provider(provider));
        if (column == null) {
            return;
        }
        transaction.executeWithoutResult(status -> entityManager.createNativeQuery(
                "UPDATE user_identities SET " + column + "=:token"
                        + " WHERE provider=:provider AND provider_uid=:providerUid")
                .setParameter("token", providerTokenEncrypted)
                .setParameter("provider", provider(provider).dbValue())
                .setParameter("providerUid", uid)
                .executeUpdate());
    }

    @Override
    public void removeIdentity(String provider, String uid) {
        transaction.executeWithoutResult(status -> entityManager.createNativeQuery("""
                DELETE FROM user_identities
                WHERE provider=:provider
                  AND provider_uid=:providerUid
                """)
                .setParameter("provider", provider(provider).dbValue())
                .setParameter("providerUid", uid)
                .executeUpdate());
    }

    /** 토큰 암호문을 두는 컬럼. 이름은 코드의 상수라 SQL 에 이어 붙여도 된다. 토큰이 없는 제공자는 {@code null}. */
    private static String tokenColumn(IdentityProvider provider) {
        return switch (provider) {
            case APPLE -> "apple_token_encrypted";
            case NAVER -> "naver_token_encrypted";
            default -> null;
        };
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
