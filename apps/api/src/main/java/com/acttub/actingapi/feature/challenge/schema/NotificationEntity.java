package com.acttub.actingapi.feature.challenge.schema;
import java.time.Instant;
import java.util.UUID;
import com.acttub.actingapi.platform.schema.*;
import jakarta.persistence.*;

@Entity
@Table(name="notifications")
public class NotificationEntity extends AppGeneratedUuidEntity {
    @Column(name="user_id", nullable=false)
    private UUID userId;
    @Convert(converter=NotificationKind.JpaConverter.class)
    @Column(name="kind", nullable=false, columnDefinition="text")
    private NotificationKind kind;
    @Column(name="actor_user_id", nullable=true)
    private UUID actorUserId;
    @Column(name="challenge_id", nullable=false)
    private UUID challengeId;
    @Column(name="entry_id", nullable=true)
    private UUID entryId;
    @Column(name="comment_id", nullable=true)
    private UUID commentId;
    @Column(name="event_key", nullable=false)
    private String eventKey;
    @Column(name="group_key", nullable=false)
    private String groupKey;
    @Column(name="created_at", nullable=false)
    private Instant createdAt;
    @Column(name="read_at", nullable=true)
    private Instant readAt;
    @Column(name="expires_at", nullable=false)
    private Instant expiresAt;
    @Column(name="push_after", nullable=true)
    private Instant pushAfter;
    @Convert(converter=NotificationPushStatus.JpaConverter.class)
    @Column(name="push_status", nullable=false, columnDefinition="text")
    private NotificationPushStatus pushStatus;
    @Column(name="push_attempted_at", nullable=true)
    private Instant pushAttemptedAt;
    protected NotificationEntity() { }
    public UUID getUserId() { return userId; }
    public NotificationKind getKind() { return kind; }
    public UUID getActorUserId() { return actorUserId; }
    public UUID getChallengeId() { return challengeId; }
    public UUID getEntryId() { return entryId; }
    public UUID getCommentId() { return commentId; }
    public String getEventKey() { return eventKey; }
    public String getGroupKey() { return groupKey; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getReadAt() { return readAt; }
    public Instant getExpiresAt() { return expiresAt; }
    public Instant getPushAfter() { return pushAfter; }
    public NotificationPushStatus getPushStatus() { return pushStatus; }
    public Instant getPushAttemptedAt() { return pushAttemptedAt; }
}
