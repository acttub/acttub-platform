package com.acttub.actingapi.feature.consent.schema;

import com.acttub.actingapi.platform.schema.*;

import java.time.Instant;
import java.util.UUID;
import jakarta.persistence.*;

@Entity
@Table(name = "user_consents")
public class UserConsentEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    UUID userId;

    @Column(name = "document_id", nullable = false)
    UUID documentId;

    @Convert(converter = ConsentAction.JpaConverter.class)
    @Column(name = "action", nullable = false, columnDefinition = "text")
    ConsentAction action;

    @Column(name = "occurred_at", nullable = false, updatable = false)
    Instant occurredAt;

    protected UserConsentEntity() {
    }

    public UserConsentEntity(
            UUID id,
            UUID userId,
            UUID documentId,
            ConsentAction action,
            Instant occurredAt) {
        super(id);
        this.userId = userId;
        this.documentId = documentId;
        this.action = action;
        this.occurredAt = occurredAt;
    }
}
