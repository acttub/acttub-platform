package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.schema.NotificationEntity;
import com.acttub.actingapi.platform.schema.NotificationKind;
import com.acttub.actingapi.platform.schema.NotificationPushStatus;
import org.springframework.data.domain.Limit;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code notifications} 를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface NotificationJpaRepository extends Repository<NotificationEntity, UUID> {

    /** 그 수신자의 그 묶음에 앞선 사건이 있으면 한 행. {@code Limit.of(1)} 로 부른다. */
    @Query("select 1 from NotificationEntity n where n.userId = :userId and n.groupKey = :groupKey")
    List<Integer> anyInGroup(UUID userId, String groupKey, Limit limit);

    /** 같은 원인(수신자·event_key)이 이미 있으면 0행이다. 함께 적는 다른 트랜잭션이 있으면 그 커밋을 기다렸다가 판정한다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into NotificationEntity (id, userId, kind, actorUserId, challengeId, entryId, commentId, eventKey, groupKey,
                                            createdAt, expiresAt, pushAfter, pushStatus)
            values (:id, :userId, :kind, :actorUserId, :challengeId, :entryId, :commentId, :eventKey, :groupKey,
                    :createdAt, :expiresAt, :pushAfter, :pushStatus)
            on conflict (userId, eventKey) do nothing
            """)
    int insertUnlessRecorded(UUID id, UUID userId, NotificationKind kind, UUID actorUserId, UUID challengeId, UUID entryId,
            UUID commentId, String eventKey, String groupKey, Instant createdAt, Instant expiresAt, Instant pushAfter,
            NotificationPushStatus pushStatus);
}
