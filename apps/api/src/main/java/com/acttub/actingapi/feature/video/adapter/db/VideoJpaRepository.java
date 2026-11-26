package com.acttub.actingapi.feature.video.adapter.db;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.video.schema.VideoEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/** {@code videos} 를 읽고 쓰는 문장. 조건부 갱신은 모두 한 문장이다(apps/api/CONTRACT.md §5-9). */
interface VideoJpaRepository extends Repository<VideoEntity, UUID> {

    /** 잠근 영상 행에서 읽는 값. */
    record LockedVideo(UUID id, String objectKey, String posterKey, Instant purgedAt) {
    }

    /** 확정이 만드는 영상. 두 시각은 앱 시계다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            insert into VideoEntity (id, userId, objectKey, contentType, byteSize, durationMs, createdAt, updatedAt)
            values (:id, :userId, :objectKey, :contentType, :byteSize, :durationMs, :now, :now)
            """)
    int insert(UUID id, UUID userId, String objectKey, String contentType, long byteSize, int durationMs, Instant now);

    /** 파기되지 않은 영상의 바이트 합 — 총량은 이것으로 센다(practice.record). */
    @Query("""
            select coalesce(sum(v.byteSize), 0)
            from VideoEntity v
            where v.userId = :userId and v.purgedAt is null
            """)
    long storedBytes(UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("""
            update VideoEntity v
            set v.favorite = :favorite, v.updatedAt = :now
            where v.id = :videoId and v.userId = :userId
            """)
    int setFavorite(UUID userId, UUID videoId, boolean favorite, Instant now);

    /** 영상 행을 잡는다 — 회차 시작(PA2)·삭제·파기·포스터 붙이기가 같은 행에서 줄을 선다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""
            select new com.acttub.actingapi.feature.video.adapter.db.VideoJpaRepository$LockedVideo(
                v.id, v.objectKey, v.posterKey, v.purgedAt)
            from VideoEntity v
            where v.id = :videoId and v.userId = :userId
            """)
    List<LockedVideo> lockOwned(UUID videoId, UUID userId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from VideoEntity v where v.id = :videoId")
    int delete(UUID videoId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update VideoEntity v set v.purgedAt = :now, v.updatedAt = :now where v.id = :videoId")
    int markPurged(UUID videoId, Instant now);

    /** 포스터 키만 적는다 — {@code updated_at} 은 두는 것이 지금 동작이다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update VideoEntity v set v.posterKey = :posterKey where v.id = :videoId")
    int attachPoster(UUID videoId, String posterKey);

    /** 이관의 주인 바꾸기. 자기 트랜잭션을 열지 않는다. */
    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update VideoEntity v set v.userId = :to where v.userId = :from")
    int reassign(UUID from, UUID to);
}
