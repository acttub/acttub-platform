package com.acttub.actingapi.feature.video.adapter.db;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.video.app.VideoRetention;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/** 트랜잭션을 열지 않는다 — 탈퇴나 3년 파기의 트랜잭션에 참여한다. */
@Repository
class PostgresVideoRetention implements VideoRetention {

    private final EntityManager entityManager;

    PostgresVideoRetention(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public void purgeFilesOf(UUID userId, Instant now) {
        entityManager.createQuery("""
                        update VideoEntity v
                        set v.purgedAt = :now, v.updatedAt = :now
                        where v.userId = :userId and v.purgedAt is null
                        """)
                .setParameter("now", now)
                .setParameter("userId", userId)
                .executeUpdate();
    }
}
