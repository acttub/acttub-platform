package com.acttub.actingapi.feature.video.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.video.app.PracticeGroupVideos;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;

/** 트랜잭션을 열지 않는다 — 연습을 지우는 트랜잭션이나 지운 영상을 파기하는 트랜잭션에 참여한다. */
@Repository
class PostgresPracticeGroupVideos implements PracticeGroupVideos {

    private final EntityManager entityManager;

    PostgresPracticeGroupVideos(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public List<GroupVideo> lockOf(UUID userId, UUID rootId) {
        return NativeTuples.list(entityManager.createNativeQuery("""
                SELECT id,object_key,poster_key,purged_at
                FROM videos
                WHERE user_id=:userId
                  AND id IN (SELECT video_id FROM practices WHERE root_id=:rootId AND user_id=:userId)
                ORDER BY id
                FOR UPDATE
                """, Tuple.class)
                .setParameter("userId", userId)
                .setParameter("rootId", rootId)).stream()
                .map(row -> new GroupVideo(
                        row.get("id", UUID.class),
                        row.get("object_key", String.class),
                        row.get("poster_key", String.class),
                        row.get("purged_at", Instant.class) != null))
                .toList();
    }

    @Override
    public void purgeFile(UUID videoId, Instant now) {
        entityManager.createQuery("delete from VideoTranscriptEntity t where t.videoId = :videoId")
                .setParameter("videoId", videoId)
                .executeUpdate();
        entityManager.createQuery("update VideoEntity v set v.purgedAt = :now, v.updatedAt = :now where v.id = :videoId")
                .setParameter("now", now)
                .setParameter("videoId", videoId)
                .executeUpdate();
    }

    @Override
    public void handOver(UUID videoId, UUID keeper, Instant now) {
        entityManager.createQuery("""
                        update VideoEntity v
                        set v.userId = :keeper, v.favorite = false, v.updatedAt = :now
                        where v.id = :videoId
                        """)
                .setParameter("keeper", keeper)
                .setParameter("now", now)
                .setParameter("videoId", videoId)
                .executeUpdate();
    }
}
