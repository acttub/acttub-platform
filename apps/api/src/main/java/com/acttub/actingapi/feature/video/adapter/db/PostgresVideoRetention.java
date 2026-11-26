package com.acttub.actingapi.feature.video.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.video.app.VideoObjectCleanup;
import com.acttub.actingapi.feature.video.app.VideoRetention;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;

/** 트랜잭션을 열지 않는다 — 탈퇴나 3년 파기의 트랜잭션에 참여한다. */
@Repository
class PostgresVideoRetention implements VideoRetention {

    private final EntityManager entityManager;
    private final VideoObjectCleanup cleanups;

    PostgresVideoRetention(EntityManager entityManager, VideoObjectCleanup cleanups) {
        this.entityManager = entityManager;
        this.cleanups = cleanups;
    }

    @Override
    public List<UUID> purgeFilesOf(UUID userId, Instant now) {
        List<String> objectKeys = objectKeys(userId);
        List<UUID> scheduled = objectKeys.isEmpty()
                ? List.of()
                : List.of(cleanups.scheduleObjectDelete(userId, objectKeys, now, now));
        entityManager.createQuery("""
                        update VideoEntity v
                        set v.purgedAt = :now, v.updatedAt = :now
                        where v.userId = :userId and v.purgedAt is null
                        """)
                .setParameter("now", now)
                .setParameter("userId", userId)
                .executeUpdate();
        return scheduled;
    }

    /**
     * 이 사람이 올린 영상의 객체 키. 얼굴과 목소리는 가명처리가 안 되므로 객체를 지운다.
     *
     * <p>장부 두 벌을 함께 본다: 옛 흐름의 {@code upload_intents} 와 0.1.0 보관함의 {@code videos} 다. 이미 파일만 파기된 영상은
     * 객체가 없으므로 빼고, 미확정 업로드의 객체는 그대로 지운다 — 예약만 하고 올리지 않았으면 그 키에 객체가 없고 파일
     * 저장소의 삭제는 멱등이다. 보관함 영상의 포스터(첫 장면 JPEG)도 얼굴이 담긴 한 장이라 함께다. 포스터 워커는
     * {@code users} 행을 잡고 붙이므로 여기서 모은 뒤에 붙는 포스터는 없다(늦게 만든 것은 워커가 장부로 보낸다).
     */
    private List<String> objectKeys(UUID userId) {
        // 은퇴한 예약 장부(upload_intents)는 Schema Entity 가 없어 native 로 둔다(CONTRACT §5-1).
        return NativeTuples.list(entityManager.createNativeQuery("""
                SELECT object_key
                FROM upload_intents
                WHERE user_id=:userId
                UNION
                SELECT object_key
                FROM videos
                WHERE user_id=:userId AND purged_at IS NULL
                UNION
                SELECT poster_key
                FROM videos
                WHERE user_id=:userId AND purged_at IS NULL AND poster_key IS NOT NULL
                """, Tuple.class)
                .setParameter("userId", userId)).stream()
                .map(row -> row.get("object_key", String.class))
                .toList();
    }
}
