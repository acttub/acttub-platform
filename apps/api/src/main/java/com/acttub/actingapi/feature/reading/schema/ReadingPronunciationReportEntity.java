package com.acttub.actingapi.feature.reading.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * {@code reading_pronunciation_reports}(V49) — 리딩 회차 하나의 발음 보고서이자 채점 작업 (SOMA-606).
 *
 * <p>회차마다 한 행이다({@code reading_session_id} 유일). {@code status} 는 queued·running·done·skipped·failed 이고 DB 값이자
 * API 값이라 문자열 그대로 둔다. 워커가 집으면 {@code lease_token}·{@code lease_until} 이 차고 닫으면 비운다. {@code result} 는
 * jsonb 를 글 그대로 읽고 쓴다 — 보고서 JSON 은 서비스가 만든다. id 는 앱이 만든다(DB 기본값도 있지만 쓰지 않는다).
 */
@Entity
@Table(name = "reading_pronunciation_reports")
public class ReadingPronunciationReportEntity extends AppGeneratedUuidEntity {

    @Column(name = "reading_session_id", nullable = false)
    private UUID readingSessionId;

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "attempt_count", nullable = false)
    private int attemptCount;

    @Column(name = "lease_token")
    private UUID leaseToken;

    @Column(name = "lease_until")
    private Instant leaseUntil;

    @Column(name = "model_version")
    private String modelVersion;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "result", columnDefinition = "jsonb")
    private String result;

    @Column(name = "failure")
    private String failure;

    /** 채점 서비스에 보낼 줄 가운데 끝낸 줄 수(V101, SOMA-1171). 집을 때 비운다. */
    @Column(name = "progress_done")
    private Integer progressDone;

    /** 채점 서비스에 보낼 줄 수(V101). */
    @Column(name = "progress_total")
    private Integer progressTotal;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected ReadingPronunciationReportEntity() {
    }

    public ReadingPronunciationReportEntity(UUID id, UUID readingSessionId, UUID userId, String status) {
        super(id);
        this.readingSessionId = readingSessionId;
        this.userId = userId;
        this.status = status;
    }

    public UUID getReadingSessionId() {
        return readingSessionId;
    }

    public String getStatus() {
        return status;
    }

    public int getAttemptCount() {
        return attemptCount;
    }

    public String getResult() {
        return result;
    }
}
