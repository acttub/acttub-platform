package com.acttub.actingapi.feature.challenge.schema;
import java.time.Instant;
import java.util.UUID;
import com.acttub.actingapi.platform.schema.*;
import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

@Entity
@Table(name="challenge_entries")
public class ChallengeEntryEntity extends AppGeneratedUuidEntity {
    @Column(name="challenge_id", nullable=false)
    private UUID challengeId;
    @Column(name="user_id", nullable=false)
    private UUID userId;
    @Column(name="video_id", nullable=true)
    private UUID videoId;
    @Column(name="caption", nullable=true)
    private String caption;
    @Column(name="content_version", nullable=false)
    private int contentVersion;
    @Column(name="published_at", nullable=true)
    private Instant publishedAt;
    @Convert(converter=ChallengeEntryVisibility.JpaConverter.class)
    @Column(name="visibility", nullable=false, columnDefinition="text")
    private ChallengeEntryVisibility visibility;
    @Convert(converter=ChallengeEntryStatus.JpaConverter.class)
    @Column(name="status", nullable=false, columnDefinition="text")
    private ChallengeEntryStatus status;
    @Column(name="view_count", nullable=false)
    private long viewCount;
    @Column(name="final_like_count", nullable=true)
    private Long finalLikeCount;
    @Column(name="final_eligible", nullable=true)
    private Boolean finalEligible;
    @Column(name="final_rank", nullable=true)
    private Integer finalRank;
    @Column(name="request_id", nullable=false)
    private UUID requestId;
    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name="request_fingerprint", nullable=false, columnDefinition="char(64)")
    private String requestFingerprint;
    @Column(name="created_at", nullable=false)
    private Instant createdAt;
    @Column(name="updated_at", nullable=false)
    private Instant updatedAt;
    @Column(name="deleted_at", nullable=true)
    private Instant deletedAt;
    protected ChallengeEntryEntity() { }
    public UUID getChallengeId() { return challengeId; }
    public UUID getUserId() { return userId; }
    public UUID getVideoId() { return videoId; }
    public String getCaption() { return caption; }
    public int getContentVersion() { return contentVersion; }
    public Instant getPublishedAt() { return publishedAt; }
    public ChallengeEntryVisibility getVisibility() { return visibility; }
    public ChallengeEntryStatus getStatus() { return status; }
    public long getViewCount() { return viewCount; }
    public Long getFinalLikeCount() { return finalLikeCount; }
    public Boolean getFinalEligible() { return finalEligible; }
    public Integer getFinalRank() { return finalRank; }
    public UUID getRequestId() { return requestId; }
    public String getRequestFingerprint() { return requestFingerprint; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }
    public Instant getDeletedAt() { return deletedAt; }
}
