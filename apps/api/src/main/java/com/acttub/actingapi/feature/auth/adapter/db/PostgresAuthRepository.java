package com.acttub.actingapi.feature.auth.adapter.db;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AcceptedConsent;
import com.acttub.actingapi.feature.auth.app.AccountDeactivation;
import com.acttub.actingapi.feature.auth.app.AuthRepository;
import com.acttub.actingapi.feature.auth.app.GuestAccounts;
import com.acttub.actingapi.feature.auth.app.IdentityAlreadyLinkedError;
import com.acttub.actingapi.feature.auth.app.SignupConsents;
import com.acttub.actingapi.feature.auth.domain.RefreshToken;
import com.acttub.actingapi.feature.auth.schema.RefreshTokenEntity;
import com.acttub.actingapi.feature.auth.schema.UserEntity;
import com.acttub.actingapi.feature.auth.schema.UserIdentityEntity;
import com.acttub.actingapi.platform.schema.IdentityProvider;
import com.acttub.actingapi.platform.schema.UserStatus;
import com.acttub.actingapi.platform.security.AuthenticatedUser;
import com.acttub.actingapi.platform.security.AuthenticatedUsers;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 사용자를 소유한 쪽이 배관의 포트를 <b>직접</b> 구현한다 — 위임만 하는 어댑터를 끼우지
 * 않는다 (ADR-017).
 *
 * <p>동의 여부는 여기 없다. 동의 문서와 그 이력을 소유한 쪽은 {@code consent} 이고, 게이트가
 * 묻는 것({@code PendingConsentGate})도 로그인 응답에 실리는 목록({@code auth/app/
 * PendingConsentDocuments})도 그쪽이 답한다 (SOMA-397 12단계).
 *
 * <p>자기 표({@code users}·{@code user_identities}·{@code refresh_tokens}·{@code user_active_days})는 Spring Data·JPQL·HQL 로 읽고
 * 쓴다. 인증 확인·토큰 갱신처럼 요청마다 도는 길의 문장 수는 native 때와 같다({@code AuthStoreIT}). native SQL 로 남은 것은 가입의
 * 동의 기록 넣기 하나다(apps/api/CONTRACT.md §5-9).
 */
@Repository
public class PostgresAuthRepository implements AuthRepository, AuthenticatedUsers, GuestAccounts {
    private final UserJpaRepository users;
    private final UserIdentityJpaRepository identities;
    private final RefreshTokenJpaRepository refreshTokens;
    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final SignupConsents signupConsents;
    private final AccountDeactivation deactivation;

    public PostgresAuthRepository(
            UserJpaRepository users,
            UserIdentityJpaRepository identities,
            RefreshTokenJpaRepository refreshTokens,
            EntityManager entityManager,
            PlatformTransactionManager transactionManager,
            SignupConsents signupConsents,
            AccountDeactivation deactivation) {
        this.deactivation = deactivation;
        this.signupConsents = signupConsents;
        this.users = users;
        this.identities = identities;
        this.refreshTokens = refreshTokens;
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    /**
     * 요청마다 부르므로 질의는 하나다. 게스트 여부는 신원으로 판정한다 — 신원이 있고 전부
     * {@code guest} 면 게스트다({@code users} 에 컬럼을 늘리지 않는다, account.guest).
     */
    @Override
    public AuthenticatedUser find(UUID id) {
        return users.findAuthenticated(id, IdentityProvider.GUEST).orElse(null);
    }

    @Override
    public AuthenticatedUser createGuest(String guestUid) {
        return transaction.execute(status -> {
            UserEntity user = users.save(new UserEntity(UUID.randomUUID(), null, UserStatus.ACTIVE));
            identities.saveAndFlush(new UserIdentityEntity(
                    UUID.randomUUID(), user.getId(), IdentityProvider.GUEST, guestUid));
            return new AuthenticatedUser(user.getId(), null, UserStatus.ACTIVE, true);
        });
    }

    @Override
    public boolean activeGuest(UUID userId) {
        AuthenticatedUser user = find(userId);
        return user != null && user.guest() && user.status() == UserStatus.ACTIVE;
    }

    /**
     * 옮겨진 게스트를 닫는다. 리프레시 토큰 <b>행은 남긴다</b> — 그 토큰으로 온 갱신에
     * {@code guest_transferred} 를 답하려면 누구의 토큰인지 알아야 한다.
     *
     * <p>트랜잭션을 열지 않는다 — 부르는 쪽(이관)의 것에 참여하고, 없으면 {@code executeUpdate} 가 거절한다.
     */
    @Override
    public void closeTransferredGuest(UUID guestId, Instant now) {
        deactivation.deactivate(guestId, now);
        identities.removeAllOf(guestId);
        refreshTokens.revokeAllActiveByUserId(guestId, now);
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
            boolean ageConfirmed,
            Instant now) {
        return transaction.execute(status -> {
            UserEntity user = users.save(new UserEntity(
                    UUID.randomUUID(), email, UserStatus.ACTIVE, ageConfirmed ? now : null));
            identities.saveAndFlush(new UserIdentityEntity(
                    UUID.randomUUID(),
                    user.getId(),
                    provider(provider),
                    uid,
                    providerTokenEncrypted));
            // 동의 기록은 `consent` 의 테이블이라 그 주인이 넣는다. 계정과 한 트랜잭션이다.
            signupConsents.record(user.getId(), consents, now);
            return authenticated(user);
        });
    }

    @Override
    public List<String> providersOf(UUID userId) {
        return identities.providersOf(userId).stream().map(IdentityProvider::dbValue).toList();
    }

    @Override
    public void markIdentityUsed(String provider, String uid, Instant now) {
        transaction.executeWithoutResult(status -> identities.markUsed(provider(provider), uid, now));
    }

    @Override
    public void updateEmailIfFree(UUID userId, String email) {
        transaction.executeWithoutResult(status -> users.updateEmailIfFree(userId, email));
    }

    @Override
    public void linkIdentity(UUID user, String provider, String uid, String providerTokenEncrypted) {
        IdentityProvider identityProvider = provider(provider);
        transaction.executeWithoutResult(status -> {
            // 토큰 칸은 제공자마다 따로다. 이미 있는 신원이면 0 이고, 그 주인을 읽어 판정한다.
            int inserted = identities.link(UUID.randomUUID(), user, identityProvider, uid,
                    identityProvider == IdentityProvider.APPLE ? providerTokenEncrypted : null,
                    identityProvider == IdentityProvider.NAVER ? providerTokenEncrypted : null);
            if (inserted == 1) {
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
        IdentityProvider identityProvider = provider(provider);
        return switch (identityProvider) {
            case APPLE -> identities.existsByProviderAndProviderUidAndAppleTokenEncryptedIsNull(identityProvider, uid);
            case NAVER -> identities.existsByProviderAndProviderUidAndNaverTokenEncryptedIsNull(identityProvider, uid);
            default -> false;
        };
    }

    /** 토큰 암호문을 두는 칸은 제공자마다 따로다. 토큰이 없는 제공자는 아무것도 하지 않는다. */
    @Override
    public void storeProviderToken(String provider, String uid, String providerTokenEncrypted) {
        IdentityProvider identityProvider = provider(provider);
        switch (identityProvider) {
            case APPLE -> transaction.executeWithoutResult(status ->
                    identities.storeAppleToken(identityProvider, uid, providerTokenEncrypted));
            case NAVER -> transaction.executeWithoutResult(status ->
                    identities.storeNaverToken(identityProvider, uid, providerTokenEncrypted));
            default -> {
            }
        }
    }

    @Override
    public void removeIdentity(String provider, String uid) {
        transaction.executeWithoutResult(status -> identities.remove(provider(provider), uid));
    }

    @Override
    public void issueRefresh(
            UUID user,
            String hash,
            Instant expires,
            String device,
            Instant issued) {
        validateHash(hash);
        transaction.executeWithoutResult(status -> {
            refreshTokens.saveAndFlush(
                    new RefreshTokenEntity(
                            UUID.randomUUID(), user, hash, device, issued, expires));
            recordActiveDay(user, issued);
        });
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
            recordActiveDay(old.userId(), now);
            return new Rotation(replacement, false);
        });
    }

    private static final ZoneId KST = ZoneId.of("Asia/Seoul");

    /**
     * 토큰을 받거나 갱신한 날(KST)을 접속일로 남긴다(V41, ops 리텐션의 원장). 하루 한 줄이라 두 번째부터는
     * 아무것도 하지 않는다. 탈퇴한 계정에는 쓰지 않는다 — 탈퇴는 토큰을 폐기한 **뒤에** 이 행을 지우므로
     * ({@code PostgresProfileRepository#withdraw}) 같은 토큰을 잡은 갱신과 순서가 정해진다.
     * {@code users} 행은 잠그지 않는다: 갱신은 토큰 행을 먼저 잡고 탈퇴는 {@code users} 행을 먼저 잡으므로
     * 여기서 {@code users} 를 잠그면 둘이 서로를 기다릴 수 있다.
     */
    private void recordActiveDay(UUID user, Instant at) {
        users.recordActiveDay(user, LocalDate.ofInstant(at, KST));
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
