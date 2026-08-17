package com.acttub.actingapi.coach.schema;
import java.time.Instant; import java.util.UUID; import jakarta.persistence.*; import org.hibernate.annotations.JdbcType;
import com.acttub.actingapi.platform.schema.SessionStatus;
import com.acttub.actingapi.platform.schema.CloseReason;
import com.acttub.actingapi.platform.schema.PgEnumJdbcType;
@Entity @Table(name="coach_sessions")
public class CoachSessionEntity {
    @Id @Column(name="id",nullable=false) UUID id; @Column(name="practice_session_id",nullable=false) UUID practiceSessionId; @Column(name="summary_id") UUID summaryId;
    @Convert(converter=SessionStatus.JpaConverter.class) @JdbcType(PgEnumJdbcType.class) @Column(name="status",nullable=false,columnDefinition="session_status_t") SessionStatus status;
    @Convert(converter=CloseReason.JpaConverter.class) @JdbcType(PgEnumJdbcType.class) @Column(name="close_reason",columnDefinition="close_reason_t") CloseReason closeReason;
    @Column(name="conversation_summary",nullable=false) String conversationSummary=""; @Column(name="created_at",nullable=false,insertable=false,updatable=false) Instant createdAt; @Column(name="updated_at",nullable=false,insertable=false,updatable=false) Instant updatedAt;
    protected CoachSessionEntity(){} public CoachSessionEntity(UUID id,UUID practiceSessionId,SessionStatus status){this.id=id;this.practiceSessionId=practiceSessionId;this.status=status;}
    public void close(CloseReason reason){this.status=SessionStatus.CLOSED;this.closeReason=reason;}
}
