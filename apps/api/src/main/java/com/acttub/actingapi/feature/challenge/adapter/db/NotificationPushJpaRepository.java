package com.acttub.actingapi.feature.challenge.adapter.db;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.challenge.schema.NotificationPushEntity;
import com.acttub.actingapi.platform.schema.NotificationPushStage;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code notification_pushes}(묶음 푸시의 선점 장부)를 읽고 쓰는 문장(apps/api/CONTRACT.md §5-9). */
interface NotificationPushJpaRepository extends Repository<NotificationPushEntity, UUID> {

    /** 그 묶음의 첫 푸시가 나갔으면 한 행. */
    @Query("select 1 from NotificationPushEntity p where p.groupKey = :groupKey and p.stage = FIRST")
    Optional<Integer> firstSent(String groupKey);

    /** 묶음의 그 단계를 선점한다. 이미 있으면 0행이다. 함께 선점하는 다른 트랜잭션이 있으면 그 커밋을 기다렸다가 판정한다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into NotificationPushEntity (id, groupKey, stage, userId, createdAt)
            values (:id, :groupKey, :stage, :userId, :now)
            on conflict (groupKey, stage) do nothing
            """)
    int claim(UUID id, String groupKey, NotificationPushStage stage, UUID userId, Instant now);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from NotificationPushEntity p where p.createdAt < :before")
    int deleteOlderThan(Instant before);
}
