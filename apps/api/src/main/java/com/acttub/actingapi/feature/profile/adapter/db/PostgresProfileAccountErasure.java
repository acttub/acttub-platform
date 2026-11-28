package com.acttub.actingapi.feature.profile.adapter.db;

import java.time.LocalDate;
import java.util.EnumSet;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

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
    private final PostgresObjectCleanupLedger cleanups;

    PostgresProfileAccountErasure(EntityManager entityManager, PostgresObjectCleanupLedger cleanups) {
        this.entityManager = entityManager;
        this.cleanups = cleanups;
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
            case PROFILE -> {
                return blurProfile(account);
            }
            default -> throw new IllegalArgumentException("not a profile step: " + step);
        }
        return List.of();
    }

    private void eraseSignupAttribution(UUID userId) {
        // 가입 유입 기록(SOMA-588)은 사람과 끊어 남기지 않고 행째 지운다 — 통계는 탈퇴 전 값으로 충분하다.
        entityManager.createQuery("delete from UserSignupAttributionEntity a where a.userId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
        // 재조회용 기기 ID(SOMA-643, V43)도 지운다 — 24시간 안에 남아 있을 수 있다.
        entityManager.createQuery("delete from UserAirbridgeDeviceLookupEntity l where l.userId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
    }

    /** 가입 직후 답한 유입 경로(SOMA-649)도 행째 지운다 — 기타의 직접 입력이 남지 않게. */
    private void eraseDiscoveryAnswer(UUID userId) {
        entityManager.createQuery("delete from UserDiscoveryAnswerEntity a where a.userId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
    }

    /**
     * 이름·사진·소개를 지우고 생년월일을 연령대로 뭉갠다. 알림 토글은 끈다. 이미 뭉갠 프로필은 연령대를 그대로 둔다.
     *
     * <p>프로필 사진(대기 중인 올리기 포함)의 객체 삭제는 키를 비우기 전에 읽어 정리 장부에 올린다. 사진은 보관 동의와 무관하게
     * 지운다.
     *
     * @return 장부에 올린 객체 삭제의 id(사진이 없으면 빈 목록)
     */
    private List<UUID> blurProfile(ClosingAccount account) {
        UUID userId = account.userId();
        List<Object[]> profiles = entityManager.createQuery(
                        "select p.birthDate, p.photoKey, p.photoUploadKey from UserProfileEntity p where p.userId = :userId",
                        Object[].class)
                .setParameter("userId", userId)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .getResultList();
        if (profiles.isEmpty()) {
            return List.of();
        }
        LocalDate birthDate = (LocalDate) profiles.getFirst()[0];
        List<String> photoKeys = Stream.of(profiles.getFirst()[1], profiles.getFirst()[2])
                .filter(Objects::nonNull)
                .map(String.class::cast)
                .toList();
        List<UUID> scheduled = photoKeys.isEmpty()
                ? List.of()
                : List.of(cleanups.schedule(userId, photoKeys, account.now(), account.now()));
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
                .setParameter("ageBand", birthDate == null ? null : AgeBand.of(birthDate, account.today()))
                .setParameter("userId", userId)
                .executeUpdate();
        return scheduled;
    }
}
