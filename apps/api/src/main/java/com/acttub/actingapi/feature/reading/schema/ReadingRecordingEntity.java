package com.acttub.actingapi.feature.reading.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import com.acttub.actingapi.platform.schema.TranscriptSource;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code reading_recordings} — 내 대사 줄 하나 = 파일 하나 (reading.recording).
 *
 * <p>{@code user_id} 는 현재 소유자다(이관 때 회차와 함께 바뀌고 탈퇴 보관 때 유지). 탈퇴 보관을 위해 회차·줄
 * 연결은 NULL 허용이고 보관 행은 일반 API 에 보이지 않는다. 같은 줄을 다시 말하면 더 큰 {@code attempt_no} 가
 * 이전 것을 대체하고, 객체 키는 요청마다 달라 재사용하지 않는다.
 */
@Entity
@Table(name = "reading_recordings")
public class ReadingRecordingEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "reading_session_id")
    private UUID readingSessionId;

    @Column(name = "line_id")
    private UUID lineId;

    @Column(name = "request_id", nullable = false)
    private UUID requestId;

    @Column(name = "attempt_no", nullable = false)
    private int attemptNo;

    @Column(name = "object_key", nullable = false)
    private String objectKey;

    @Column(name = "content_type", nullable = false)
    private String contentType;

    @Column(name = "byte_size", nullable = false)
    private long byteSize;

    @Column(name = "duration_ms", nullable = false)
    private int durationMs;

    @Column(name = "transcript")
    private String transcript;

    @Convert(converter = TranscriptSource.JpaConverter.class)
    @Column(name = "transcript_source", nullable = false, columnDefinition = "text")
    private TranscriptSource transcriptSource;

    @Column(name = "matched")
    private Boolean matched;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected ReadingRecordingEntity() {
    }

    public ReadingRecordingEntity(
            UUID id, UUID userId, UUID readingSessionId, UUID lineId, UUID requestId, int attemptNo,
            String objectKey, String contentType, long byteSize, int durationMs, String transcript,
            TranscriptSource transcriptSource, Boolean matched) {
        super(id);
        this.userId = userId;
        this.readingSessionId = readingSessionId;
        this.lineId = lineId;
        this.requestId = requestId;
        this.attemptNo = attemptNo;
        this.objectKey = objectKey;
        this.contentType = contentType;
        this.byteSize = byteSize;
        this.durationMs = durationMs;
        this.transcript = transcript;
        this.transcriptSource = transcriptSource;
        this.matched = matched;
    }

    public UUID getUserId() {
        return userId;
    }

    public UUID getReadingSessionId() {
        return readingSessionId;
    }

    public UUID getLineId() {
        return lineId;
    }

    public UUID getRequestId() {
        return requestId;
    }

    public int getAttemptNo() {
        return attemptNo;
    }

    public String getObjectKey() {
        return objectKey;
    }

    public String getContentType() {
        return contentType;
    }

    public long getByteSize() {
        return byteSize;
    }

    public int getDurationMs() {
        return durationMs;
    }

    public String getTranscript() {
        return transcript;
    }

    public TranscriptSource getTranscriptSource() {
        return transcriptSource;
    }

    public Boolean getMatched() {
        return matched;
    }

    public Instant getCreatedAt() {
        return createdAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
