package com.acttub.actingapi.feature.reading.schema;

import java.time.Instant;
import java.util.UUID;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

/**
 * {@code reading_recording_retranscripts}(V79) — 리딩 녹음 하나의 서버 다시 받아쓰기 작업.
 *
 * <p>녹음마다 한 행이고 PK 가 녹음 id 다(녹음을 지우면 함께 지워진다). {@code status} 는 queued·running·done·stale·silent·
 * empty·failed 이고 문자열 그대로 둔다. 워커가 집으면 {@code lease_token}·{@code lease_until} 이 차고 닫으면 비운다.
 * {@code transcribed_at} 은 모델을 부른 시각으로 하루 한도를 세는 데 쓴다. 행은 저장소의 HQL upsert 로만 넣는다.
 */
@Entity
@Table(name = "reading_recording_retranscripts")
public class ReadingRecordingRetranscriptEntity {

    @Id
    @Column(name = "recording_id")
    private UUID recordingId;

    @Column(name = "object_key", nullable = false)
    private String objectKey;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "attempt_count", nullable = false)
    private int attemptCount;

    @Column(name = "lease_token")
    private UUID leaseToken;

    @Column(name = "lease_until")
    private Instant leaseUntil;

    @Column(name = "peak_db")
    private Double peakDb;

    @Column(name = "transcript")
    private String transcript;

    @Column(name = "transcribed_at")
    private Instant transcribedAt;

    @Column(name = "failure")
    private String failure;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected ReadingRecordingRetranscriptEntity() {
    }
}
