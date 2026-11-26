package com.acttub.actingapi.feature.auth.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountDeactivation;
import com.acttub.actingapi.platform.schema.UserStatus;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import org.springframework.stereotype.Repository;

/** 계정 행을 잠그고 닫는다. 트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다. */
@Repository
class PostgresAccountDeactivation implements AccountDeactivation {

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
