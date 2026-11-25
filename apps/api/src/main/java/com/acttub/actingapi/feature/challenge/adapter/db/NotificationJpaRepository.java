package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.Collection;
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

    // ---- 알림함 ----

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update NotificationEntity n set n.readAt = :now
            where n.userId = :userId and n.groupKey in :groupKeys and n.readAt is null and n.createdAt <= :now
            """)
    int readGroups(UUID userId, Collection<String> groupKeys, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update NotificationEntity n set n.readAt = :now where n.userId = :userId and n.readAt is null and n.createdAt <= :before")
    int readUpTo(UUID userId, Instant before, Instant now);

    /** (만든 시각, id) 순서로 그 사건까지. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update NotificationEntity n set n.readAt = :now
            where n.userId = :userId and n.readAt is null and (n.createdAt, n.id) <= (:before, :beforeId)
            """)
    int readUpToEvent(UUID userId, Instant before, UUID beforeId, Instant now);

    /**
     * 안 읽은 묶음 수. 사건이 지금도 유효한 것만 센다 — 좋아요가 남아 있고(event_key 의 "like:" 뒤가 좋아요 행 id 다), 댓글이
     * 지워지거나 숨겨지지 않았고, 행동자와 수신자 사이에 어느 쪽으로도 차단이 없다. 알림함·발송의 네이티브 조건(VALID)과 같다.
     */
    @Query("""
            select count(distinct n.groupKey) from NotificationEntity n
            where n.userId = :userId and n.expiresAt > :now and n.readAt is null
              and ((n.kind = ENTRY_LIKED and exists (select 1 from EntryLikeEntity l
                        where l.id = case when n.kind = ENTRY_LIKED then cast(substring(n.eventKey, 6) as java.util.UUID) end))
                or (n.kind = ENTRY_COMMENTED and exists (select 1 from EntryCommentEntity c
                        where c.id = n.commentId and c.deletedAt is null and c.status = VISIBLE))
                or n.kind in (CHALLENGE_ENDED, ENTRY_AI_REPORT_READY))
              and (n.actorUserId is null or not exists (select 1 from UserBlockEntity b
                        where (b.blockerId = n.userId and b.blockedId = n.actorUserId)
                           or (b.blockerId = n.actorUserId and b.blockedId = n.userId)))
            """)
    long countUnreadGroups(UUID userId, Instant now);

    // ---- 발송 ----

    record Due(UUID userId, String groupKey) { }

    /** 보낼 때가 된 사건이 있는 (수신자, 묶음). */
    @Query("""
            select distinct new com.acttub.actingapi.feature.challenge.adapter.db.NotificationJpaRepository$Due(n.userId, n.groupKey)
            from NotificationEntity n where n.pushStatus = PENDING and n.pushAfter <= :now
            """)
    List<Due> dueGroups(Instant now, Limit limit);

    /** 발송 결과를 적는다. 보낸 것만 시도 시각이 있다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update NotificationEntity n set n.pushStatus = :status, n.pushAttemptedAt = :attemptedAt where n.id in :ids")
    int markPush(Collection<UUID> ids, NotificationPushStatus status, Instant attemptedAt);

    /** 지운 참여작에 관한 알림을 지운다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from NotificationEntity n where n.entryId = :entryId")
    int deleteOfEntry(UUID entryId);

    /** 보관 기간(90일)이 지난 알림을 지운다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from NotificationEntity n where n.expiresAt <= :now")
    int deleteExpired(Instant now);
}
