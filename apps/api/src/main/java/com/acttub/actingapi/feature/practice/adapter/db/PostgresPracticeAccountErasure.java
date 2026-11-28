package com.acttub.actingapi.feature.practice.adapter.db;

import java.time.ZoneOffset;
import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountErasure;
import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 계정을 닫을 때 지운 연습의 뒤처리를 하고, 옛 연습 흐름의 분석 중이던 연습을 실패로 닫는다 (account.withdraw).
 *
 * <p>앞서 지운 연습의 무료 횟수 표시는 지우고, 보관 동의가 없으면 지운 연습에서 남겨 둔 영상도 지금 파기한다. 회차
 * ({@code practices})와 옛 연습({@code practice_sessions})의 행은 사람과 끊어 남긴다 — 지우지 않는다.
 *
 * <p>트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다.
 */
@Repository
class PostgresPracticeAccountErasure implements AccountErasure {

    private final EntityManager entityManager;
    private final DeletedPracticeVideoPurge deletedVideos;

    PostgresPracticeAccountErasure(EntityManager entityManager, DeletedPracticeVideoPurge deletedVideos) {
        this.entityManager = entityManager;
        this.deletedVideos = deletedVideos;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return EnumSet.of(AccountErasureStep.DELETED_PRACTICES, AccountErasureStep.LEGACY_PRACTICES);
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        if (step == AccountErasureStep.DELETED_PRACTICES) {
            deletedVideos.forgetMarksOf(account.userId());
            return account.retainMedia() ? List.of() : deletedVideos.purgeAllOf(account.userId(), account.now());
        }
        // practice_sessions 는 매핑을 내린 옛 연습 흐름 표라 native 로 둔다(CONTRACT §5-1).
        entityManager.createNativeQuery("""
                UPDATE practice_sessions
                SET status='failed',updated_at=:now
                WHERE user_id=:userId
                  AND status='analyzing'
                """)
                .setParameter("now", account.now().atOffset(ZoneOffset.UTC))
                .setParameter("userId", account.userId())
                .executeUpdate();
        return List.of();
    }
}
