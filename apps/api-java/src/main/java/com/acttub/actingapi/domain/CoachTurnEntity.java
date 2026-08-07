package com.acttub.actingapi.domain;
import java.time.Instant; import java.util.UUID; import jakarta.persistence.*; import org.hibernate.annotations.JdbcType;
@Entity @Table(name="coach_turns")
public class CoachTurnEntity {
    @Id @GeneratedValue(strategy=GenerationType.IDENTITY) @Column(name="id") Long id; @Column(name="session_id",nullable=false) UUID sessionId; @Column(name="turn_index",nullable=false) int turnIndex;
    @Convert(converter=TurnRole.JpaConverter.class) @JdbcType(PgEnumJdbcType.class) @Column(name="role",nullable=false,columnDefinition="turn_role_t") TurnRole role;
    @Column(name="text",nullable=false) String text; @Column(name="created_at",nullable=false,insertable=false,updatable=false) Instant createdAt; protected CoachTurnEntity(){}
    public CoachTurnEntity(UUID sessionId,int turnIndex,TurnRole role,String text){this.sessionId=sessionId;this.turnIndex=turnIndex;this.role=role;this.text=text;}
}
