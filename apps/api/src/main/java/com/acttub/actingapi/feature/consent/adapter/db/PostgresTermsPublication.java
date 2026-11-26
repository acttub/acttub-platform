package com.acttub.actingapi.feature.consent.adapter.db;

import java.time.Instant;
import java.util.Optional;

import com.acttub.actingapi.feature.consent.app.TermsPublication;
import com.acttub.actingapi.platform.schema.ConsentType;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

@Repository
class PostgresTermsPublication implements TermsPublication {

    private final EntityManager entityManager;

    PostgresTermsPublication(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Optional<Instant> paidTermsPublishedAt() {
        return Optional.ofNullable(entityManager.createQuery("""
                        select min(d.publishedAt) from ConsentDocumentEntity d
                        where d.type = :terms and d.version <> 'v1' and d.locale = 'ko'
                        """, Instant.class)
                .setParameter("terms", ConsentType.TERMS)
                .getSingleResult());
    }
}
