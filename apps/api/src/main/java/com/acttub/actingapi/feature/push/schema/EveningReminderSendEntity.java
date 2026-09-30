package com.acttub.actingapi.feature.push.schema;
import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.IdClass;
import jakarta.persistence.Table;
@Entity @Table(name = "evening_reminder_sends") @IdClass(EveningReminderSendId.class)
public class EveningReminderSendEntity {
    @Id @Column(name = "user_id", nullable = false) private UUID userId;
    @Id @Column(name = "day", nullable = false) private LocalDate day;
    @Column(name = "sent_at", nullable = false, insertable = false, updatable = false) private Instant sentAt;
    protected EveningReminderSendEntity() {}
}
