package com.acttub.actingapi.feature.consent.adapter.db;

import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.consent.schema.ConsentDocumentEntity;
import com.acttub.actingapi.platform.schema.ConsentType;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ConsentDocumentJpaRepository
        extends JpaRepository<ConsentDocumentEntity, UUID> {
    Optional<ConsentDocumentEntity> findByTypeAndVersion(ConsentType type, String version);

    /** 같은 판이라도 말이 다르면 다른 행이다 (SOMA-544). */
    Optional<ConsentDocumentEntity> findByTypeAndVersionAndLocale(
            ConsentType type, String version, String locale);
}
