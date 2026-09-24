package com.acttub.actingapi.feature.video.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code videos} — 배우의 보관함에 있는 영상 한 편 (practice.record, practice.library).
 *
 * <p>영상은 연습에서 독립한 자산이다 — 코칭 회차와 챌린지 참여작이 같은 행을 가리키고 객체는 하나다.
 * {@code purgedAt} 이 있으면 "파일만 파기"나 탈퇴 파기를 거친 것이라 객체·받아쓰기가 없고, 재생이 막히며
 * 총량에서 빠진다. 그래도 회차·참여작의 기록은 그대로다.
 *
 * <p>{@code posterKey} 는 워커가 뒤에 만든 첫 장면 JPEG 의 키이고(V23), {@code posterAttempts} 는 워커가 이 영상을
 * 집은 횟수다 — 상한에 닿으면 더 고르지 않는다.
 */
@Entity
@Table(name = "videos")
public class VideoEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "object_key", nullable = false)
    private String objectKey;

    @Column(name = "content_type", nullable = false)
    private String contentType;

    @Column(name = "byte_size", nullable = false)
    private long byteSize;

    @Column(name = "duration_ms", nullable = false)
    private int durationMs;

    @Column(name = "width")
    private Integer width;

    @Column(name = "height")
    private Integer height;

    @Column(name = "favorite", nullable = false)
    private boolean favorite;

    @Column(name = "purged_at")
    private Instant purgedAt;

    @Column(name = "poster_key")
    private String posterKey;

    @Column(name = "poster_attempts", nullable = false)
    private short posterAttempts;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    protected VideoEntity() {
    }

    public VideoEntity(UUID id, UUID userId, String objectKey, String contentType, long byteSize, int durationMs) {
        super(id);
        this.userId = userId;
        this.objectKey = objectKey;
        this.contentType = contentType;
        this.byteSize = byteSize;
        this.durationMs = durationMs;
    }

    public UUID userId() {
        return userId;
    }

    public String objectKey() {
        return objectKey;
    }

    public String contentType() {
        return contentType;
    }

    public long byteSize() {
        return byteSize;
    }

    public int durationMs() {
        return durationMs;
    }

    public Integer width() {
        return width;
    }

    public Integer height() {
        return height;
    }

    public boolean favorite() {
        return favorite;
    }

    public Instant purgedAt() {
        return purgedAt;
    }

    public String posterKey() {
        return posterKey;
    }

    public short posterAttempts() {
        return posterAttempts;
    }

    public Instant createdAt() {
        return createdAt;
    }

    public Instant updatedAt() {
        return updatedAt;
    }
}
