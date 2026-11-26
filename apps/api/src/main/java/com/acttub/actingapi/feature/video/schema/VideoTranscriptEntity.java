package com.acttub.actingapi.feature.video.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;
import tools.jackson.databind.JsonNode;

/**
 * {@code video_transcripts}(V14) — 영상 하나의 받아쓰기 묶음. 영상당 하나({@code uq_video_transcripts_video})이고 같은 영상의 다음
 * 회차가 다시 쓴다. 넣기는 분석 저장소의 native SQL 이고, 보관함은 영상을 지우거나 파기할 때 이 매핑으로 지운다.
 */
@Entity
@Table(name = "video_transcripts")
public class VideoTranscriptEntity extends AppGeneratedUuidEntity {

    @Column(name = "video_id", nullable = false)
    private UUID videoId;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "source")
    private String source;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "segments", nullable = false, columnDefinition = "jsonb")
    private JsonNode segments;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    @Column(name = "completed_at")
    private Instant completedAt;

    protected VideoTranscriptEntity() {
    }

    public VideoTranscriptEntity(UUID id, UUID videoId, String status, String source, JsonNode segments,
            Instant completedAt) {
        super(id);
        this.videoId = videoId;
        this.status = status;
        this.source = source;
        this.segments = segments;
        this.completedAt = completedAt;
    }
}
