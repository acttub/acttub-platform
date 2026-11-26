package com.acttub.actingapi.feature.consent.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AcceptedConsent;
import com.acttub.actingapi.feature.auth.app.SignupConsents;
import com.acttub.actingapi.platform.schema.ConsentAction;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/** 트랜잭션을 열지 않는다 — 계정을 만드는 트랜잭션에 참여한다. 결정마다 한 문장이고 받은 순서대로 넣는다. */
@Repository
class PostgresSignupConsents implements SignupConsents {

    private final EntityManager entityManager;

    PostgresSignupConsents(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public void record(UUID userId, List<AcceptedConsent> consents, Instant now) {
        for (AcceptedConsent consent : consents) {
            entityManager.createQuery("""
                            insert into UserConsentEntity (id, userId, documentId, action, occurredAt)
                            values (:id, :userId, :documentId, :action, :occurredAt)
                            """)
                    .setParameter("id", UUID.randomUUID())
                    .setParameter("userId", userId)
                    .setParameter("documentId", consent.documentId())
                    .setParameter("action", ConsentAction.valueOf(consent.action().toUpperCase(Locale.ROOT)))
                    .setParameter("occurredAt", now)
                    .executeUpdate();
        }
    }
}
