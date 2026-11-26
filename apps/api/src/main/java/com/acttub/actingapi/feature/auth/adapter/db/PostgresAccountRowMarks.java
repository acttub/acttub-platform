package com.acttub.actingapi.feature.auth.adapter.db;

import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AgeConfirmation;
import com.acttub.actingapi.feature.auth.app.ExitSurveyAsk;
import com.acttub.actingapi.feature.auth.app.MemoryEpoch;
import com.acttub.actingapi.platform.schema.UserStatus;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 계정 행({@code users})에 얹힌 다른 기능의 칸 셋: 나이 확인(consent), 이탈 설문을 물어본 표식(feedback), 배우 기억의 세대
 * (memory). 뜻은 그 기능의 것이고 행을 고치는 것은 여기다(ADR-040).
 */
@Repository
class PostgresAccountRowMarks implements AgeConfirmation, ExitSurveyAsk, MemoryEpoch {

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;

    PostgresAccountRowMarks(EntityManager entityManager, PlatformTransactionManager transactionManager) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
    }

    @Override
    public boolean confirmed(UUID userId) {
        return !entityManager.createQuery(
                        "select u.id from UserEntity u where u.id = :userId and u.ageConfirmedAt is not null", UUID.class)
                .setParameter("userId", userId)
                .getResultList()
                .isEmpty();
    }

    @Override
    public void confirm(UUID userId, Instant now) {
        transaction.executeWithoutResult(status -> entityManager.createQuery("""
                        update UserEntity u
                        set u.ageConfirmedAt = :now, u.updatedAt = :now
                        where u.id = :userId and u.ageConfirmedAt is null
                        """)
                .setParameter("now", now)
                .setParameter("userId", userId)
                .executeUpdate());
    }

    @Override
    public boolean claim(UUID userId, Instant now) {
        return Boolean.TRUE.equals(transaction.execute(status -> entityManager.createQuery("""
                        update UserEntity u
                        set u.exitSurveyAskedAt = :now, u.updatedAt = :now
                        where u.id = :userId and u.status = :active and u.exitSurveyAskedAt is null
                        """)
                .setParameter("now", now)
                .setParameter("userId", userId)
                .setParameter("active", UserStatus.ACTIVE)
                .executeUpdate() > 0));
    }

    @Override
    public void carryOver(UUID from, UUID to) {
        // 같은 표의 다른 행(게스트)을 읽어 회원 행을 고치는 UPDATE … FROM 이라 native 로 둔다(HQL 에 없다).
        entityManager.createNativeQuery("""
                UPDATE users member
                SET exit_survey_asked_at=LEAST(
                        COALESCE(member.exit_survey_asked_at, guest.exit_survey_asked_at),
                        COALESCE(guest.exit_survey_asked_at, member.exit_survey_asked_at)),
                    updated_at=now()
                FROM users guest
                WHERE member.id=:to
                  AND guest.id=:from
                  AND guest.exit_survey_asked_at IS NOT NULL
                """)
                .setParameter("to", to)
                .setParameter("from", from)
                .executeUpdate();
    }

    @Override
    public void bump(UUID userId) {
        entityManager.createQuery("""
                        update UserEntity u
                        set u.memoryEpoch = u.memoryEpoch + 1, u.updatedAt = instant
                        where u.id = :userId
                        """)
                .setParameter("userId", userId)
                .executeUpdate();
    }
}
