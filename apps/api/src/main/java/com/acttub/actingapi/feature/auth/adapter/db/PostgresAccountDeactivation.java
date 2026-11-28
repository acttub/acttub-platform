package com.acttub.actingapi.feature.auth.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountDeactivation;
import com.acttub.actingapi.feature.auth.app.AccountRowLock;
import com.acttub.actingapi.platform.schema.UserStatus;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import org.springframework.stereotype.Repository;

/**
 * 계정 행을 잠그고 닫는다. <b>계정의 상태를 바꾸는 문장은 이 파일에만 둔다.</b> 허용되는 길은 {@code UserStatusTransition} 에
 * 있다({@code StateTransitionTest}).
 *
 * <p>트랜잭션을 열지 않는다 — 부르는 쪽(계정을 닫는 일, 회원 자료를 쓰는 일)의 트랜잭션에 참여한다.
 */
@Repository
class PostgresAccountDeactivation implements AccountDeactivation, AccountRowLock {

    private final EntityManager entityManager;

    PostgresAccountDeactivation(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public State lock(UUID userId) {
        List<UserStatus> status = entityManager.createQuery(
                        "select u.status from UserEntity u where u.id = :userId", UserStatus.class)
                .setParameter("userId", userId)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .getResultList();
        if (status.isEmpty()) {
            return null;
        }
        return status.getFirst() == UserStatus.DEACTIVATED ? State.DEACTIVATED : State.ACTIVE;
    }

    /** 다른 기능이 자기 쓰기 앞에 거는 잠금. 계정을 닫는 쪽({@link #lock})과 같은 문장이라 서로 줄을 선다. */
    @Override
    public boolean lockActive(UUID userId) {
        return lock(userId) == State.ACTIVE;
    }

    @Override
    public void deactivate(UUID userId, Instant now) {
        entityManager.createQuery("""
                        update UserEntity u
                        set u.status = :deactivated, u.deactivatedAt = :now, u.updatedAt = :now
                        where u.id = :userId
                        """)
                .setParameter("deactivated", UserStatus.DEACTIVATED)
                .setParameter("now", now)
                .setParameter("userId", userId)
                .executeUpdate();
    }

    @Override
    public void eraseRow(UUID userId) {
        entityManager.createQuery("delete from UserEntity u where u.id = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
    }

    @Override
    public Instant deactivatedAt(UUID userId) {
        return entityManager.createQuery("select u.deactivatedAt from UserEntity u where u.id = :userId", Instant.class)
                .setParameter("userId", userId)
                .getSingleResult();
    }
}
