package com.acttub.actingapi.feature.practice.adapter.db;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.schema.PracticeSessionEntity;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** 단순한 연습 세션 읽기는 Schema Entity로 수행하고, 복합 projection과 잠금은 Adapter에 둔다. */
interface PracticeSessionJpaRepository extends Repository<PracticeSessionEntity, UUID> {
    Optional<PracticeSessionEntity> findByIdAndUserIdAndHiddenAtIsNull(UUID id, UUID userId);

    List<PracticeSessionEntity> findByUserIdAndHiddenAtIsNullOrderByCreatedAtDescIdDesc(UUID userId);

    @Query("""
            SELECT session.continuedFrom
            FROM PracticeSessionEntity session
            WHERE session.id = :sessionId
              AND session.userId = :userId
              AND session.hiddenAt IS NULL
            """)
    Optional<UUID> findParent(UUID userId, UUID sessionId);
}
