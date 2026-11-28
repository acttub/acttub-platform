package com.acttub.actingapi.feature.push.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.push.app.PushRecords;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/** 닫히는 게스트의 푸시 기록 둘과 푸시 토큰을 지운다. 트랜잭션을 열지 않는다 — 이관의 트랜잭션에 참여한다. */
@Repository
class PostgresPushRecords implements PushRecords {

    private final EntityManager entityManager;

    PostgresPushRecords(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public void discardTransferredGuest(UUID guestId) {
        entityManager.createQuery("delete from PracticeReminderSendEntity s where s.userId = :guestId")
                .setParameter("guestId", guestId)
                .executeUpdate();
        // push_opens 는 Schema Entity 가 없어 native 로 둔다.
        entityManager.createNativeQuery("DELETE FROM push_opens WHERE user_id=:guestId")
                .setParameter("guestId", guestId)
                .executeUpdate();
        entityManager.createQuery("delete from PushTokenEntity t where t.userId = :guestId")
                .setParameter("guestId", guestId)
                .executeUpdate();
    }
}
