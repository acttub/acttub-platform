package com.acttub.actingapi.feature.challenge.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * 좋아요순 첫 조회가 굳혀 둔 순서와 순위. {@code entry_ids} 와 {@code ranks} 는 같은 길이이고 순서를 지킨다(순위 0은 순위 없음).
 * 기준({@code basis}: live·pending·final)이 바뀌거나 10분이 지나면 커서가 만료된다. 저장소는 HQL insert·delete 로만 쓴다.
 */
@Entity
@Table(name = "entry_ranking_snapshots")
public class EntryRankingSnapshotEntity extends AppGeneratedUuidEntity {
    @Column(name = "challenge_id", nullable = false)
    private UUID challengeId;
    @Column(name = "viewer_id", nullable = false)
    private UUID viewerId;
    @Column(name = "basis", nullable = false, columnDefinition = "text")
    private String basis;
    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "entry_ids", nullable = false, columnDefinition = "uuid[]")
    private UUID[] entryIds;
    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "ranks", nullable = false, columnDefinition = "integer[]")
    private Integer[] ranks;
    @Column(name = "created_at", nullable = false)
    private Instant createdAt;

    protected EntryRankingSnapshotEntity() { }

    public UUID getChallengeId() { return challengeId; }
    public UUID getViewerId() { return viewerId; }
    public String getBasis() { return basis; }
    public UUID[] getEntryIds() { return entryIds; }
    public Integer[] getRanks() { return ranks; }
    public Instant getCreatedAt() { return createdAt; }
}
