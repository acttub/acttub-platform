package com.acttub.actingapi.feature.auth.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.RetentionPurge;
import com.acttub.actingapi.feature.auth.app.StaleRefreshTokens;
import com.acttub.actingapi.feature.auth.app.TransferredGuestActiveDays;
import com.acttub.actingapi.platform.schema.UserStatus;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 계정이 닫힌 뒤의 정리에서 {@code auth} 의 표를 고치는 일: 오래된 리프레시 토큰, 옮겨진 게스트의 접속일, 탈퇴 3년 뒤의 신원
 * 해시와 파기 시각 (account.login, account.guest, account.withdraw).
 *
 * <p>오래된 토큰 지우기만 자기 트랜잭션을 연다. 나머지는 부르는 쪽(이관, 3년 파기)의 트랜잭션에 참여한다.
 */
@Repository
class PostgresAccountHousekeeping implements StaleRefreshTokens, TransferredGuestActiveDays, RetentionPurge {

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresAccountHousekeeping(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    /**
     * 한 문장으로 지운다. 회전된 옛 토큰은 새 토큰을 {@code replaced_by_id} 로 가리키는데, 새 토큰이 지울 때가 됐으면 그보다
     * 먼저 폐기된 옛 토큰도 지울 때가 됐다 — FK 는 문장 끝에서 본다.
     */
    @Override
    public int deleteStale(Instant before) {
        return transaction.execute(status -> entityManager.createQuery(
                        "delete from RefreshTokenEntity t where t.expiresAt < :before or t.revokedAt < :before")
                .setParameter("before", before)
                .executeUpdate());
    }

    @Override
    public void discard(UUID guestId) {
        entityManager.createQuery("delete from UserActiveDayEntity d where d.userId = :guestId")
                .setParameter("guestId", guestId)
                .executeUpdate();
    }

    @Override
    public List<UUID> lockExpired(Instant deactivatedBefore) {
        return entityManager.createQuery("""
                        select u.id
                        from UserEntity u
                        where u.status = :deactivated
                          and u.deactivatedAt < :cutoff
                          and u.retentionPurgedAt is null
                        order by u.deactivatedAt, u.id
                        """, UUID.class)
                .setParameter("deactivated", UserStatus.DEACTIVATED)
                .setParameter("cutoff", deactivatedBefore)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .getResultList();
    }

    @Override
    public void complete(UUID userId, Instant now) {
        entityManager.createQuery("delete from UserIdentityEntity i where i.userId = :userId and i.uidHash is not null")
                .setParameter("userId", userId)
                .executeUpdate();
        entityManager.createQuery("update UserEntity u set u.retentionPurgedAt = :now where u.id = :userId")
                .setParameter("now", now)
                .setParameter("userId", userId)
                .executeUpdate();
    }
}
