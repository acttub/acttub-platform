package com.acttub.actingapi.feature.coach.schema;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.AppGeneratedUuidEntity;
import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Table;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/**
 * {@code coach_conversations}(V14) — 0.1.0 회차의 코치 대화. 회차에 하나다({@code uq_coach_conversations_practice}). 상태와 종료
 * 사유는 DB 값 그대로 문자열이고 허용 값은 CHECK 가 지킨다. 코칭 상태({@code state})는 통째로 읽고 쓰는 JSON 글이다 — 저장소가
 * 직렬화한 글을 그대로 넘긴다. 쓰기는 대화 행을 잠그고 {@code state_revision} 을 다시 본 뒤 HQL 한 문장으로 한다.
 */
@Entity
@Table(name = "coach_conversations")
public class CoachConversationEntity extends AppGeneratedUuidEntity {

    @Column(name = "practice_id", nullable = false)
    UUID practiceId;

    @Column(name = "start_request_id", nullable = false)
    UUID startRequestId;

    @Column(name = "status", nullable = false)
    String status;

    @Column(name = "close_reason")
    String closeReason;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "state", nullable = false, columnDefinition = "jsonb")
    String state;

    @Column(name = "state_revision", nullable = false)
    int stateRevision;

    @Column(name = "created_at", nullable = false, updatable = false)
    Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    Instant updatedAt;

    @Column(name = "closed_at")
    Instant closedAt;

    protected CoachConversationEntity() {
    }

    /** 방금 연 대화 — 상태는 빈 객체, revision 0 이다. */
    public CoachConversationEntity(UUID id, UUID practiceId, UUID startRequestId, Instant now) {
        super(id);
        this.practiceId = practiceId;
        this.startRequestId = startRequestId;
        this.status = "open";
        this.state = "{}";
        this.createdAt = now;
        this.updatedAt = now;
    }
}
