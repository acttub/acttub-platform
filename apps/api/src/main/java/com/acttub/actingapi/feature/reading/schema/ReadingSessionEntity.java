package com.acttub.actingapi.feature.reading.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import com.acttub.actingapi.platform.schema.ReadingAdvance;
import com.acttub.actingapi.platform.schema.ReadingMode;
import com.acttub.actingapi.platform.schema.ReadingSessionStatus;
import com.fasterxml.jackson.databind.JsonNode;
import jakarta.persistence.Column;
import jakarta.persistence.Convert;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * {@code reading_sessions} — 리딩 회차 (reading.cast · reading.session).
 *
 * <p>속성(내 배역·방식·구간·넘김·녹음)은 시작할 때 정하고 뒤에 바꾸지 않는다. {@code current_line_id} 는 다음에
 * 할 대사 줄이고 completed 면 NULL 이다. {@code progress_seq} 는 기기가 1씩 늘리는 순번이라 서버는 저장된 값보다
 * 큰 요청만 반영한다. {@code line_results} 는 줄마다 하나인 {@code {line_id, outcome, misses}} 배열이다.
 * 열린 회차는 대본당 하나다(부분 유일 인덱스 — Hibernate 는 검증하지 않는다).
 */
@Entity
@Table(name = "reading_sessions")
public class ReadingSessionEntity extends AppGeneratedUuidEntity {

    @Column(name = "script_id", nullable = false)
    private UUID scriptId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "request_id")
    private UUID requestId;

    @JdbcTypeCode(SqlTypes.ARRAY)
    @Column(name = "my_character_ids", nullable = false, columnDefinition = "uuid[]")
    private UUID[] myCharacterIds;

    @Convert(converter = ReadingMode.JpaConverter.class)
    @Column(name = "mode", nullable = false, columnDefinition = "text")
    private ReadingMode mode;

    @Column(name = "start_line_id", nullable = false)
    private UUID startLineId;

    @Column(name = "end_line_id", nullable = false)
    private UUID endLineId;

    @Convert(converter = ReadingAdvance.JpaConverter.class)
    @Column(name = "advance", nullable = false, columnDefinition = "text")
    private ReadingAdvance advance;

    @Column(name = "record", nullable = false)
    private boolean record;

    @Convert(converter = ReadingSessionStatus.JpaConverter.class)
    @Column(name = "status", nullable = false, columnDefinition = "text")
    private ReadingSessionStatus status;

    @Column(name = "current_line_id")
    private UUID currentLineId;

    @Column(name = "elapsed_seconds", nullable = false)
    private int elapsedSeconds;

    @Column(name = "progress_seq", nullable = false)
    private long progressSeq;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "line_results", nullable = false, columnDefinition = "jsonb")
    private JsonNode lineResults;

    @Column(name = "started_at", nullable = false, insertable = false, updatable = false)
    private Instant startedAt;

    @Column(name = "ended_at")
    private Instant endedAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected ReadingSessionEntity() {
    }

    public ReadingSessionEntity(
            UUID id, UUID scriptId, UUID userId, UUID requestId, UUID[] myCharacterIds, ReadingMode mode,
            UUID startLineId, UUID endLineId, ReadingAdvance advance, boolean record, ReadingSessionStatus status,
            UUID currentLineId, JsonNode lineResults) {
        super(id);
        this.scriptId = scriptId;
        this.userId = userId;
        this.requestId = requestId;
        this.myCharacterIds = myCharacterIds;
        this.mode = mode;
        this.startLineId = startLineId;
        this.endLineId = endLineId;
        this.advance = advance;
        this.record = record;
        this.status = status;
        this.currentLineId = currentLineId;
        this.lineResults = lineResults;
    }

    public UUID getScriptId() {
        return scriptId;
    }

    public UUID getUserId() {
        return userId;
    }

    public UUID getRequestId() {
        return requestId;
    }

    public UUID[] getMyCharacterIds() {
        return myCharacterIds;
    }

    public ReadingMode getMode() {
        return mode;
    }

    public UUID getStartLineId() {
        return startLineId;
    }

    public UUID getEndLineId() {
        return endLineId;
    }

    public ReadingAdvance getAdvance() {
        return advance;
    }

    public boolean isRecord() {
        return record;
    }

    public ReadingSessionStatus getStatus() {
        return status;
    }

    public UUID getCurrentLineId() {
        return currentLineId;
    }

    public int getElapsedSeconds() {
        return elapsedSeconds;
    }

    public long getProgressSeq() {
        return progressSeq;
    }

    public JsonNode getLineResults() {
        return lineResults;
    }

    public Instant getStartedAt() {
        return startedAt;
    }

    public Instant getEndedAt() {
        return endedAt;
    }

    public Instant getUpdatedAt() {
        return updatedAt;
    }
}
