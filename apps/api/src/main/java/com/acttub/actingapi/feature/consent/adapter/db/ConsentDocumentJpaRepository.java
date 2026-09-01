package com.acttub.actingapi.feature.consent.adapter.db;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.consent.schema.ConsentDocumentEntity;
import com.acttub.actingapi.platform.schema.ConsentType;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ConsentDocumentJpaRepository
        extends JpaRepository<ConsentDocumentEntity, UUID> {
    Optional<ConsentDocumentEntity> findByTypeAndVersion(ConsentType type, String version);
}
