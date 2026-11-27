package com.acttub.actingapi.feature.challenge.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.challenge.app.UserBlocking;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/** 트랜잭션을 열지 않는다 — 부르는 쪽의 것에 참여한다. 차단한 시각은 DB 의 기본값(지금)이다. */
@Repository
class PostgresUserBlocking implements UserBlocking {

    private final EntityManager entityManager;

    PostgresUserBlocking(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public void block(UUID blockerId, UUID blockedId) {
        entityManager.createQuery("""
                        insert into UserBlockEntity (id, blockerId, blockedId) values (:id, :blockerId, :blockedId)
                        on conflict (blockerId, blockedId) do nothing
                        """)
                .setParameter("id", UUID.randomUUID())
                .setParameter("blockerId", blockerId)
                .setParameter("blockedId", blockedId)
                .executeUpdate();
    }

    @Override
    public boolean blockedEitherWay(UUID first, UUID second) {
        return !entityManager.createQuery("""
                        select b.id from UserBlockEntity b
                        where (b.blockerId = :first and b.blockedId = :second)
                           or (b.blockerId = :second and b.blockedId = :first)
                        """, UUID.class)
                .setParameter("first", first)
                .setParameter("second", second)
                .setMaxResults(1)
                .getResultList()
                .isEmpty();
    }
}
