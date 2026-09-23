package com.acttub.actingapi.feature.video.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.video.app.VideoOwnership;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 이관의 주인 바꾸기. ⚠ <b>트랜잭션을 열지 않는다</b> — 이관 트랜잭션에 참여한다(CONTRACT §6-9).
 *
 * <p>영상과 예약 장부를 함께 옮긴다. 예약을 두고 가면 옛 게스트의 대기 업로드가 마무리될 자리를 잃는다 —
 * 기기는 같은 요청 id 로 다시 시도하므로 회원 계정에서 이어진다. 객체는 그대로고 주인만 바뀐다.
 */
@Repository
class PostgresVideoOwnership implements VideoOwnership {
    private final EntityManager entityManager;

    PostgresVideoOwnership(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public void reassign(UUID from, UUID to) {
        // 게스트와 회원의 request_id 가 겹치면(UUID 라 실질적으로 없다) 게스트 쪽 값을 비우고 옮긴다.
        entityManager.createNativeQuery("""
                UPDATE upload_intents AS guest
                SET request_id=NULL
                WHERE guest.user_id=:from
                  AND guest.request_id IS NOT NULL
                  AND EXISTS (SELECT 1 FROM upload_intents AS member
                              WHERE member.user_id=:to AND member.request_id=guest.request_id)
                """)
                .setParameter("from", from)
                .setParameter("to", to)
                .executeUpdate();
        for (String table : java.util.List.of("videos", "upload_intents")) {
            entityManager.createNativeQuery("UPDATE " + table + " SET user_id=:to WHERE user_id=:from")
                    .setParameter("to", to)
                    .setParameter("from", from)
                    .executeUpdate();
        }
    }
}
