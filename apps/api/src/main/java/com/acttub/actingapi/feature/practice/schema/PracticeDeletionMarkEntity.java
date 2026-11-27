package com.acttub.actingapi.feature.practice.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code practice_deletion_marks}(V85) — 지운 회차 하나의 무료 횟수 표시. 지워도 오늘 쓴 무료 코칭 횟수에서 빠지지 않게 회차를
 * 만든 시각을 남기고, 40일 뒤 매일 정리가 지운다(practice.library 「연습 삭제」). 넣기와 지우기는 HQL 이고, 횟수를 세는 쪽은
 * 회차 조회의 native 문장이다.
 */
@Entity
@Table(name = "practice_deletion_marks")
public class PracticeDeletionMarkEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    private UUID userId;

    @Column(name = "practice_created_at", nullable = false)
    private Instant practiceCreatedAt;

    @Column(name = "from_reading", nullable = false)
    private boolean fromReading;

    @Column(name = "deleted_at", nullable = false)
    private Instant deletedAt;

    protected PracticeDeletionMarkEntity() {
    }

    public PracticeDeletionMarkEntity(UUID id, UUID userId, Instant practiceCreatedAt, boolean fromReading,
            Instant deletedAt) {
        super(id);
        this.userId = userId;
        this.practiceCreatedAt = practiceCreatedAt;
        this.fromReading = fromReading;
        this.deletedAt = deletedAt;
    }
}
