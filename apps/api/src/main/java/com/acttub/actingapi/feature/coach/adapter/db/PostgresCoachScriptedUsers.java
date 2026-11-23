package com.acttub.actingapi.feature.coach.adapter.db;

import java.util.Locale;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.CoachScriptedUsers;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/** 정해진 코칭 대본 대상인지 users.email 로 가린다. 코치 응답은 트랜잭션 밖이라 getResultList() 로 다 받아 온다. */
@Repository
class PostgresCoachScriptedUsers implements CoachScriptedUsers {
    private final EntityManager entityManager;

    PostgresCoachScriptedUsers(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public boolean contains(UUID userId, Set<String> emails) {
        if (userId == null || emails == null || emails.isEmpty()) return false;
        Object email = entityManager.createNativeQuery("SELECT email FROM users WHERE id=:id AND email IS NOT NULL")
                .setParameter("id", userId).getResultList().stream().findFirst().orElse(null);
        return email instanceof String text && emails.contains(text.strip().toLowerCase(Locale.ROOT));
    }
}
