package com.acttub.actingapi.consent.schema;
import com.acttub.actingapi.schema.*;
import java.time.Instant; import java.util.UUID; import jakarta.persistence.*; import org.hibernate.annotations.JdbcType;
@Entity @Table(name="user_consents")
public class UserConsentEntity extends AppGeneratedUuidEntity {
    @Column(name="user_id",nullable=false) UUID userId; @Column(name="document_id",nullable=false) UUID documentId;
    @Convert(converter=ConsentAction.JpaConverter.class) @JdbcType(PgEnumJdbcType.class) @Column(name="action",nullable=false,columnDefinition="consent_action_t") ConsentAction action;
    @Column(name="occurred_at",nullable=false,insertable=false,updatable=false) Instant occurredAt;
    protected UserConsentEntity(){} public UserConsentEntity(UUID id,UUID userId,UUID documentId,ConsentAction action){super(id);this.userId=userId;this.documentId=documentId;this.action=action;}
}
