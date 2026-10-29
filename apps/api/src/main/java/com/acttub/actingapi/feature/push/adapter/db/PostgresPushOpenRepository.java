package com.acttub.actingapi.feature.push.adapter.db;

import java.util.UUID;

import com.acttub.actingapi.feature.push.app.PushOpenRepository;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

@Repository
class PostgresPushOpenRepository implements PushOpenRepository {
    private final EntityManager entityManager;

    PostgresPushOpenRepository(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    /** ⚠ {@code users} 는 {@code auth} 의 것이라 native SQL 로 활성만 거른다(다른 feature 의 Entity 를 import 하지 않는다). */
    @Override
    @Transactional
    public void record(UUID userId, String kind, String reminderKind, String templateId, String platform, String appVersion) {
        entityManager.createNativeQuery("""
                INSERT INTO push_opens(user_id,kind,reminder_kind,template_id,platform,app_version)
                SELECT id,:kind,:reminderKind,:templateId,:platform,:appVersion
                FROM users
                WHERE id=:userId AND status='active'
                """)
                .setParameter("userId", userId)
                .setParameter("kind", kind)
                .setParameter("reminderKind", reminderKind)
                .setParameter("templateId", templateId)
                .setParameter("platform", platform)
                .setParameter("appVersion", appVersion)
                .executeUpdate();
    }
}
