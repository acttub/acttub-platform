package com.acttub.actingapi.feature.community.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/** 게시판 사진의 올리기 장부({@code community_post_images}). 글에 붙이고 떼는 일은 {@link CommunityRepository} 가 한다. */
public interface CommunityImageRepository {

    /**
     * 올릴 자리를 만든다. 아직 글에 붙지 않은 이 사람의 올리기가 {@code pendingLimit} 개 이상이면 만들지 않고 거짓.
     */
    boolean begin(PendingImage image, int pendingLimit, Instant now);

    /** 이 사람이 올린 사진 하나. 없거나 남의 것이면 {@code null}. */
    PendingImage find(UUID uploaderId, UUID imageId);

    /** 올라온 것을 확인했다. */
    void markUploaded(UUID imageId, Instant now);

    /**
     * {@code before} 전에 만들어지고 글에 붙지 않은 행을 지우고 객체 삭제를 장부에 올린다.
     *
     * @return 장부의 id 들
     */
    List<UUID> sweepUnattached(Instant before, Instant now);

    record PendingImage(
            UUID id,
            UUID uploaderId,
            UUID postId,
            String objectKey,
            String mimeType,
            long sizeBytes,
            Instant expiresAt,
            boolean uploaded) {
    }
}
