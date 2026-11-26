package com.acttub.actingapi.feature.video.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.video.app.PendingUploads;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

@Repository
class PostgresPendingUploads implements PendingUploads {

    private final EntityManager entityManager;

    PostgresPendingUploads(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public boolean pending(UUID ownerId, UUID intentId) {
        // 은퇴한 예약 장부(upload_intents)는 Schema Entity 가 없어 native 로 둔다(CONTRACT §5-1).
        return !entityManager.createNativeQuery(
                        "SELECT 1 AS pending FROM upload_intents WHERE id=:id AND user_id=:owner AND video_id IS NULL")
                .setParameter("id", intentId)
                .setParameter("owner", ownerId)
                .getResultList()
                .isEmpty();
    }
}
