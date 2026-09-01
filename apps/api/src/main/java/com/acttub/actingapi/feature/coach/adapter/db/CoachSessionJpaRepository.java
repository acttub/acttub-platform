package com.acttub.actingapi.feature.coach.adapter.db;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.schema.CoachSessionEntity;
import com.acttub.actingapi.platform.schema.SessionStatus;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

interface CoachSessionJpaRepository extends Repository<CoachSessionEntity, UUID> {
    @Modifying
    @Query("""
            UPDATE CoachSessionEntity session
            SET session.status = :status,
                session.conversationSummary = :conversationSummary,
                session.updatedAt = :updatedAt
            WHERE session.id = :sessionId
            """)
    int updateState(
            UUID sessionId,
            SessionStatus status,
            String conversationSummary,
            Instant updatedAt);

    @Modifying
    @Query("""
            UPDATE CoachSessionEntity session
            SET session.status = :closed,
                session.updatedAt = :updatedAt
            WHERE session.practiceSessionId = :practiceSessionId
              AND session.status = :open
            """)
    int closeOpenByPracticeSessionId(
            UUID practiceSessionId,
            SessionStatus open,
            SessionStatus closed,
            Instant updatedAt);

    @Modifying
    @Query("""
            UPDATE CoachSessionEntity session
            SET session.status = :status,
                session.updatedAt = :updatedAt
            WHERE session.id = :sessionId
            """)
    int updateStatus(UUID sessionId, SessionStatus status, Instant updatedAt);
}
