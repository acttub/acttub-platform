package com.acttub.actingapi.feature.challenge.schema;
import java.time.Instant;
import java.util.UUID;
import com.acttub.actingapi.platform.schema.*;
import jakarta.persistence.*;

@Entity
@Table(name="notification_pushes")
public class NotificationPushEntity extends AppGeneratedUuidEntity {
    @Column(name="group_key", nullable=false)
    private String groupKey;
    @Convert(converter=NotificationPushStage.JpaConverter.class)
    @Column(name="stage", nullable=false, columnDefinition="text")
    private NotificationPushStage stage;
    @Column(name="user_id", nullable=false)
    private UUID userId;
    @Column(name="created_at", nullable=false)
    private Instant createdAt;
    protected NotificationPushEntity() { }
    public String getGroupKey() { return groupKey; }
    public NotificationPushStage getStage() { return stage; }
    public UUID getUserId() { return userId; }
    public Instant getCreatedAt() { return createdAt; }
}
