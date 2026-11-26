package com.acttub.actingapi.feature.auth.adapter.db;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountErasure;
import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import com.acttub.actingapi.feature.auth.app.ProviderDisconnectCleanup;
import com.acttub.actingapi.platform.schema.IdentityProvider;
import com.acttub.actingapi.platform.security.AccountSecrets;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;

/**
 * 계정을 닫을 때 {@code auth} 의 표에서 하는 일: 신원, 이메일, 리프레시 토큰, 접속일 (account.withdraw, ADR-029).
 *
 * <p>트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다.
 */
@Repository
class PostgresAuthAccountErasure implements AccountErasure {

    private final EntityManager entityManager;
    private final AccountSecrets secrets;
    private final ProviderDisconnectCleanup cleanups;

    PostgresAuthAccountErasure(EntityManager entityManager, AccountSecrets secrets, ProviderDisconnectCleanup cleanups) {
        this.entityManager = entityManager;
        this.secrets = secrets;
        this.cleanups = cleanups;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return EnumSet.of(AccountErasureStep.IDENTITIES, AccountErasureStep.EMAIL, AccountErasureStep.SESSIONS);
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        return switch (step) {
            case IDENTITIES -> hashIdentities(account);
            case EMAIL -> {
                eraseEmail(account.userId());
                yield List.of();
            }
            case SESSIONS -> {
                endSessions(account);
                yield List.of();
            }
            default -> throw new IllegalArgumentException("not an auth step: " + step);
        };
    }

    /** 신원·토큰·접속일은 계정 그 자체라 계정 행과 함께 지워도 된다. */
    @Override
    public boolean hasRecords(UUID userId) {
        return false;
    }

    /**
     * 신원마다 해시만 남기고 제공자 ID 와 토큰을 비운다. 그 전에 서버가 해제해야 하는 제공자의 값을 장부로 옮긴다 — 애플은
     * 토큰으로 폐기하고, 카카오는 회원번호로 끊고, 네이버는 refresh token 을 폐기한다. 구글은 앱이 탈퇴 요청 직전에 SDK 로 끊는다.
     *
     * <p>이미 해시로 바뀐 신원(다시 온 탈퇴 요청)은 건드리지 않는다. 게스트 신원은 해시를 남기지 않고 지운다.
     */
    private List<UUID> hashIdentities(ClosingAccount account) {
        List<UUID> scheduled = new ArrayList<>();
        List<Tuple> identities = entityManager.createQuery("""
                        select i.id as id, i.provider as provider, i.providerUid as providerUid,
                               i.appleTokenEncrypted as appleToken, i.naverTokenEncrypted as naverToken
                        from UserIdentityEntity i
                        where i.userId = :userId and i.providerUid is not null
                        """, Tuple.class)
                .setParameter("userId", account.userId())
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .getResultList();
        for (Tuple identity : identities) {
            UUID id = identity.get("id", UUID.class);
            IdentityProvider provider = identity.get("provider", IdentityProvider.class);
            String providerUid = identity.get("providerUid", String.class);
            // 게스트 신원은 해시 없이 행째 지운다(account.guest). 서버가 만든 난수라 다시 올 사람이 없고,
            // 해시의 쓰임인 보관 동의 철회도 게스트에게는 없다(선택 문서를 묻지 않는다).
            if (provider == IdentityProvider.GUEST) {
                entityManager.createQuery("delete from UserIdentityEntity i where i.id = :id")
                        .setParameter("id", id)
                        .executeUpdate();
                continue;
            }
            String appleToken = identity.get("appleToken", String.class);
            String naverToken = identity.get("naverToken", String.class);
            // 토큰은 이미 암호문이라 그대로 옮긴다. 카카오 회원번호는 평문이었으므로 여기서 암호화한다.
            if (provider == IdentityProvider.APPLE && appleToken != null) {
                scheduled.add(cleanups.enqueue(account.userId(), "apple_revoke", appleToken, account.now()));
            } else if (provider == IdentityProvider.NAVER && naverToken != null) {
                scheduled.add(cleanups.enqueue(account.userId(), "naver_revoke", naverToken, account.now()));
            } else if (provider == IdentityProvider.KAKAO) {
                scheduled.add(cleanups.enqueue(account.userId(), "kakao_unlink", secrets.encrypt(providerUid), account.now()));
            }
            entityManager.createQuery("""
                            update UserIdentityEntity i
                            set i.uidHash = :uidHash, i.providerUid = null,
                                i.appleTokenEncrypted = null, i.naverTokenEncrypted = null
                            where i.id = :id
                            """)
                    .setParameter("uidHash", secrets.identityHash(provider.dbValue(), providerUid))
                    .setParameter("id", id)
                    .executeUpdate();
        }
        return scheduled;
    }

    /**
     * ⚠ 새 코드가 {@code users.nickname} 을 건드리는 곳은 이 한 문장뿐이다 (SOMA-528 결정 I-3). V9 는 옛 닉네임을
     * {@code user_profiles.name} 으로 복사만 해서 값이 이 컬럼에도 남아 있고, 탈퇴는 이름을 지체 없이 파기해야 한다. 컬럼을
     * 지우려면 먼저 이 쓰기를 걷어낸 릴리스를 내고(N+1), 그다음 릴리스에서 DROP COLUMN 한다(N+2) — 삭제와 그것을 안 쓰는 코드를
     * 한 릴리스에 묶지 않는다(docs/BRANCHING-STRATEGY.md 「DB와 배포 안전성」).
     *
     * <p>{@code nickname} 은 {@code UserEntity} 에 매핑하지 않아 native 로 둔다.
     */
    private void eraseEmail(UUID userId) {
        entityManager.createNativeQuery("""
                        UPDATE users
                        SET email=NULL,nickname=NULL
                        WHERE id=:userId
                        """)
                .setParameter("userId", userId)
                .executeUpdate();
    }

    /**
     * 리프레시 토큰을 폐기하고 접속일(V41)을 지운다. 접속일은 사람과 끊어 남기지 않는다 — 처리방침의 「탈퇴 후 남기는 것」에 없다.
     *
     * <p>⚠ 토큰을 폐기한 <b>뒤에</b> 접속일을 지운다. 같은 토큰을 잡고 있던 갱신은 폐기가 기다린 뒤 커밋되므로, 지우는 문장이 그
     * 갱신이 남긴 줄까지 본다.
     */
    private void endSessions(ClosingAccount account) {
        entityManager.createQuery("""
                        update RefreshTokenEntity t
                        set t.revokedAt = :now
                        where t.userId = :userId and t.revokedAt is null
                        """)
                .setParameter("now", account.now())
                .setParameter("userId", account.userId())
                .executeUpdate();
        entityManager.createQuery("delete from UserActiveDayEntity d where d.userId = :userId")
                .setParameter("userId", account.userId())
                .executeUpdate();
    }
}
