package com.acttub.actingapi.schema;
import java.time.Instant; import java.util.UUID; import jakarta.persistence.*;
@Entity @Table(name="handoff_confirmations")
public class HandoffConfirmationEntity {
    @Id @Column(name="coaching_handoff_id",nullable=false) UUID coachingHandoffId; @Column(name="confirmed",nullable=false) boolean confirmed; @Column(name="rebuttal_text") String rebuttalText;
    @Column(name="created_at",nullable=false,insertable=false,updatable=false) Instant createdAt; @Column(name="updated_at",nullable=false,insertable=false,updatable=false) Instant updatedAt;
    protected HandoffConfirmationEntity(){} public HandoffConfirmationEntity(UUID coachingHandoffId,boolean confirmed,String rebuttalText){this.coachingHandoffId=coachingHandoffId;this.confirmed=confirmed;this.rebuttalText=rebuttalText;}
}
