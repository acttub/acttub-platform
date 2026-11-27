package com.acttub.actingapi.feature.auth.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountFacts;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 트랜잭션 밖에서도 불린다(코치 응답). 공유 EntityManager 는 조회가 끝나면 바로 닫히므로 결과를 다 받아 오는
 * {@code getResultList()} 를 쓴다.
 */
@Repository
class PostgresAccountFacts implements AccountFacts {

    private final EntityManager entityManager;

    PostgresAccountFacts(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Optional<Instant> signedUpAt(UUID userId) {
        return entityManager.createQuery("select u.createdAt from UserEntity u where u.id = :userId", Instant.class)
                .setParameter("userId", userId)
                .getResultList().stream().findFirst();
    }

    @Override
    public Optional<String> email(UUID userId) {
        return entityManager.createQuery(
                        "select u.email from UserEntity u where u.id = :userId and u.email is not null", String.class)
                .setParameter("userId", userId)
                .getResultList().stream().findFirst();
    }
}
