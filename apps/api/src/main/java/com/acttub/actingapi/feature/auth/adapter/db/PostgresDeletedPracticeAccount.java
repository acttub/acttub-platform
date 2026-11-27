package com.acttub.actingapi.feature.auth.adapter.db;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.DeletedPracticeAccount;
import com.acttub.actingapi.platform.schema.UserStatus;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/** 트랜잭션을 열지 않는다 — 연습을 지우는 트랜잭션에 참여한다. */
@Repository
class PostgresDeletedPracticeAccount implements DeletedPracticeAccount {

    /** 지운 연습을 들고 있는 계정. 로그인할 신원이 없고 상태는 {@code deactivated} 다. */
    static final UUID ID = UUID.fromString("00000000-0000-4000-8000-00000000de1e");

    private final EntityManager entityManager;

    PostgresDeletedPracticeAccount(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public UUID ensure(Instant now) {
        entityManager.createQuery("""
                        insert into UserEntity (id, status, createdAt, updatedAt, retentionPurgedAt)
                        values (:id, :deactivated, :now, :now, :now)
                        on conflict (id) do nothing
                        """)
                .setParameter("id", ID)
                .setParameter("deactivated", UserStatus.DEACTIVATED)
                .setParameter("now", now)
                .executeUpdate();
        return ID;
    }
}
