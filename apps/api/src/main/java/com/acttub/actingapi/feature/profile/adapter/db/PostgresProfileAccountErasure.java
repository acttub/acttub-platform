package com.acttub.actingapi.feature.profile.adapter.db;

import java.time.LocalDate;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountErasure;
import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import com.acttub.actingapi.feature.profile.domain.AgeBand;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import org.springframework.stereotype.Repository;

/**
 * 계정을 닫을 때 {@code profile} 의 표에서 하는 일: 프로필, 가입 유입 기록, 유입 경로 답 (account.withdraw).
 *
 * <p>트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다.
 */
@Repository
class PostgresProfileAccountErasure implements AccountErasure {

    private final EntityManager entityManager;

    PostgresProfileAccountErasure(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return EnumSet.of(AccountErasureStep.SIGNUP_ATTRIBUTION, AccountErasureStep.DISCOVERY_ANSWER, AccountErasureStep.PROFILE);
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        switch (step) {
            case SIGNUP_ATTRIBUTION -> eraseSignupAttribution(account.userId());
            case DISCOVERY_ANSWER -> eraseDiscoveryAnswer(account.userId());
            case PROFILE -> blurProfile(account.userId(), account.today());
            default -> throw new IllegalArgumentException("not a profile step: " + step);
        }
        return List.of();
    }

    /**
     * 프로필과 유입 기록은 계정 행과 함께 지워진다({@code ON DELETE CASCADE}). 정리 장부에 남은 일은 계정 행을 가리킨 채
     * 끝까지 가야 하므로 자료로 센다.
     */
    @Override
    public boolean hasRecords(UUID userId) {
        return !entityManager.createQuery("select o.id from AccountCleanupOperationEntity o where o.userId = :userId", UUID.class)
                .setParameter("userId", userId)
                .setMaxResults(1)
                .getResultList()
                .isEmpty();
    }

    private void eraseSignupAttribution(UUID userId) {
        // 가입 유입 기록(SOMA-588)은 사람과 끊어 남기지 않고 행째 지운다 — 통계는 탈퇴 전 값으로 충분하다.
        entityManager.createNativeQuery("DELETE FROM user_signup_attributions WHERE user_id=:userId")
                .setParameter("userId", userId)
                .executeUpdate();
        // 재조회용 기기 ID(SOMA-643, V43)도 지운다 — 24시간 안에 남아 있을 수 있다.
        entityManager.createNativeQuery("DELETE FROM user_airbridge_device_lookups WHERE user_id=:userId")
                .setParameter("userId", userId)
                .executeUpdate();
    }

    /** 가입 직후 답한 유입 경로(SOMA-649)도 행째 지운다 — 기타의 직접 입력이 남지 않게. */
    private void eraseDiscoveryAnswer(UUID userId) {
        entityManager.createNativeQuery("DELETE FROM user_discovery_answers WHERE user_id=:userId")
                .setParameter("userId", userId)
                .executeUpdate();
    }

    /** 이름·사진·소개를 지우고 생년월일을 연령대로 뭉갠다. 알림 토글은 끈다. 이미 뭉갠 프로필은 연령대를 그대로 둔다. */
    private void blurProfile(UUID userId, LocalDate today) {
        List<LocalDate> birthDates = entityManager.createQuery(
                        "select p.birthDate from UserProfileEntity p where p.userId = :userId", LocalDate.class)
                .setParameter("userId", userId)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .getResultList();
        if (birthDates.isEmpty()) {
            return;
        }
        LocalDate birthDate = birthDates.getFirst();
        entityManager.createQuery("""
                        update UserProfileEntity p
                        set p.name = null, p.photoKey = null, p.bio = null, p.birthDate = null,
                            p.ageBand = coalesce(cast(:ageBand as Integer), p.ageBand),
                            p.photoUploadKey = null, p.photoUploadMimeType = null,
                            p.photoUploadSizeBytes = null, p.photoUploadExpiresAt = null,
                            p.notifyAnalysisDone = false, p.notifyChallenge = false, p.notifyEveningReminder = false,
                            p.updatedAt = instant
                        where p.userId = :userId
                        """)
                .setParameter("ageBand", birthDate == null ? null : AgeBand.of(birthDate, today))
                .setParameter("userId", userId)
                .executeUpdate();
    }
}
