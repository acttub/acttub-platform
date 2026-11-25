package com.acttub.actingapi.feature.memory.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;

/**
 * {@code actor_memories}(V14·V52) — 0.1.0 배우 기억. 칸·작성자는 DB 값 그대로 문자열이고 허용 값은 CHECK 가 지킨다. 장면 단위
 * 칸은 {@code scene_root_id} 가 있다(SOMA-795). 쓰기(배우·갱신 작업)는 다른 기능의 표를 함께 보는 native 문장이 한다.
 */
@Entity
@Table(name = "actor_memories")
public class ActorMemoryEntity extends AppGeneratedUuidEntity {

    @Column(name = "user_id", nullable = false)
    UUID userId;

    @Column(name = "field", nullable = false)
    String field;

    @Column(name = "value", nullable = false)
    String value;

    @Column(name = "written_by", nullable = false)
    String writtenBy;

    @Column(name = "source_practice_id")
    UUID sourcePracticeId;

    @Column(name = "scene_root_id")
    UUID sceneRootId;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    Instant updatedAt;

    protected ActorMemoryEntity() {
    }

    public ActorMemoryEntity(UUID id, UUID userId, String field, String value, String writtenBy) {
        super(id);
        this.userId = userId;
        this.field = field;
        this.value = value;
        this.writtenBy = writtenBy;
    }
}
