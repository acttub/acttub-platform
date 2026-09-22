package com.acttub.actingapi.feature.challenge.schema;

import java.time.Instant;
import java.time.LocalDate;
import java.util.UUID;
import com.acttub.actingapi.platform.schema.*;
import jakarta.persistence.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** 대사·기간·운영 상태. 삭제·탈퇴에도 개설 이력을 보존한다. */
@Entity
@Table(name = "challenges")
public class ChallengeEntity extends AppGeneratedUuidEntity {
    @Column(name = "line", nullable = false)
    private String line;
    @Column(name = "work", nullable = false)
    private String work;
    @Column(name = "character", nullable = true)
    private String character;
    @Column(name = "scene_note", nullable = true)
    private String sceneNote;
    @Column(name = "duration_days", nullable = false)
    private int durationDays;
    @Convert(converter = ChallengeOrigin.JpaConverter.class)
    @Column(name = "origin", nullable = false, columnDefinition = "text")
    private ChallengeOrigin origin;
    @Column(name = "host_user_id", nullable = true)
    private UUID hostUserId;
    @Column(name = "request_id", nullable = false)
    private UUID requestId;
    @JdbcTypeCode(SqlTypes.CHAR)
    @Column(name = "request_fingerprint", nullable = false, columnDefinition = "char(64)")
    private String requestFingerprint;
    @Column(name = "featured_on", nullable = true)
    private LocalDate featuredOn;
    @Column(name = "starts_at", nullable = false)
    private Instant startsAt;
    @Column(name = "ends_at", nullable = false)
    private Instant endsAt;
    @Convert(converter = ChallengeModeration.JpaConverter.class)
    @Column(name = "moderation", nullable = false, columnDefinition = "text")
    private ChallengeModeration moderation;
    @Column(name = "deleted_at", nullable = true)
    private Instant deletedAt;
    @Convert(converter = ChallengeRankingState.JpaConverter.class)
    @Column(name = "ranking_state", nullable = true, columnDefinition = "text")
    private ChallengeRankingState rankingState;
    @Column(name = "finalized_at", nullable = true)
    private Instant finalizedAt;

    protected ChallengeEntity() { }
    public ChallengeEntity(UUID id, String line, String work, String character, String sceneNote, int durationDays,
            ChallengeOrigin origin, UUID hostUserId, UUID requestId, String requestFingerprint,
            LocalDate featuredOn, Instant startsAt, Instant endsAt) {
        super(id);
        this.line = line;
        this.work = work;
        this.character = character;
        this.sceneNote = sceneNote;
        this.durationDays = durationDays;
        this.origin = origin;
        this.hostUserId = hostUserId;
        this.requestId = requestId;
        this.requestFingerprint = requestFingerprint;
        this.featuredOn = featuredOn;
        this.startsAt = startsAt;
        this.endsAt = endsAt;
        this.moderation = ChallengeModeration.VISIBLE;
    }
    public String getLine() { return line; }
    public String getWork() { return work; }
    public String getCharacter() { return character; }
    public String getSceneNote() { return sceneNote; }
    public int getDurationDays() { return durationDays; }
    public ChallengeOrigin getOrigin() { return origin; }
    public UUID getHostUserId() { return hostUserId; }
    public UUID getRequestId() { return requestId; }
    public String getRequestFingerprint() { return requestFingerprint; }
    public LocalDate getFeaturedOn() { return featuredOn; }
    public Instant getStartsAt() { return startsAt; }
    public Instant getEndsAt() { return endsAt; }
    public ChallengeModeration getModeration() { return moderation; }
    public Instant getDeletedAt() { return deletedAt; }
    public ChallengeRankingState getRankingState() { return rankingState; }
    public Instant getFinalizedAt() { return finalizedAt; }
    public void moderate(ChallengeModeration next) { moderation = next; }
    public void delete(Instant now) { deletedAt = now; }
}
