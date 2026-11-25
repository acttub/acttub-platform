package com.acttub.actingapi.feature.community.adapter.db;

import java.time.Instant;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import com.acttub.actingapi.feature.community.schema.CommunityPostImageEntity;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.Repository;

/**
 * {@code community_post_images} 를 읽고 쓰는 문장. 지우는 문장은 지울 행을 먼저 잠가 읽고 그 id 로 지운다 — 읽은 키와 지운 행이
 * 같다(apps/api/CONTRACT.md §5-9).
 */
interface CommunityPostImageJpaRepository extends Repository<CommunityPostImageEntity, UUID> {

    CommunityPostImageEntity save(CommunityPostImageEntity image);

    @Query("select count(i) from CommunityPostImageEntity i where i.uploaderId = :uploaderId and i.postId is null")
    long countUnattached(UUID uploaderId);

    @Query("select i from CommunityPostImageEntity i where i.id = :id and i.uploaderId = :uploaderId")
    Optional<CommunityPostImageEntity> findOwned(UUID id, UUID uploaderId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update CommunityPostImageEntity i set i.uploadedAt = :now where i.id = :id and i.uploadedAt is null")
    int markUploaded(UUID id, Instant now);

    /** 붙일 사진 행. id 순으로 잠가 같은 사진을 함께 붙이는 두 글 쓰기가 서로를 기다리며 막히지 않게 한다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select i from CommunityPostImageEntity i where i.id in :ids order by i.id")
    List<CommunityPostImageEntity> lockByIds(Collection<UUID> ids);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select i from CommunityPostImageEntity i where i.postId = :postId")
    List<CommunityPostImageEntity> lockAttachedTo(UUID postId);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select i from CommunityPostImageEntity i where i.postId = :postId and i.id not in :keep")
    List<CommunityPostImageEntity> lockAttachedToExcept(UUID postId, Collection<UUID> keep);

    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select i from CommunityPostImageEntity i where i.postId is null and i.createdAt < :before")
    List<CommunityPostImageEntity> lockUnattachedBefore(Instant before);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("delete from CommunityPostImageEntity i where i.id in :ids")
    int deleteByIds(Collection<UUID> ids);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update CommunityPostImageEntity i set i.postId = null, i.sortOrder = null where i.postId = :postId")
    int detachAll(UUID postId);

    @Modifying(flushAutomatically = true, clearAutomatically = true)
    @Query("update CommunityPostImageEntity i set i.postId = :postId, i.sortOrder = :sortOrder where i.id = :id")
    int attach(UUID id, UUID postId, int sortOrder);

    /** 글들에 붙은 사진, 글마다 보여 줄 순서로. */
    @Query("""
            select i.id as id, i.postId as postId, i.objectKey as objectKey
            from CommunityPostImageEntity i
            where i.postId in :postIds
            order by i.postId, i.sortOrder
            """)
    List<AttachedImage> attachedTo(Collection<UUID> postIds);

    interface AttachedImage {
        UUID getId();

        UUID getPostId();

        String getObjectKey();
    }
}
