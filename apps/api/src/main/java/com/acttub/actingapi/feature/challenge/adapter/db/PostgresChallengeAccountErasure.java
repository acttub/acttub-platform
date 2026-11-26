package com.acttub.actingapi.feature.challenge.adapter.db;

import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountErasure;
import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import com.acttub.actingapi.platform.schema.ChallengeEntryStatus;
import com.acttub.actingapi.platform.schema.ChallengeEntryVisibility;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 계정을 닫을 때 챌린지 자료를 정리한다 (specs/challenge 「챌린지 자료의 삭제·탈퇴」, account.withdraw).
 *
 * <p>참여작은 비공개로 내려 집계·표본에서 빠지고(다시 공개할 수 없다 — 공개 전환은 활성 계정만 된다), 개설한 챌린지는 주최자를
 * 비운다. 건 차단·받은 차단, 개인 북마크(저장), 받은 알림은 행째 지우고, AI 리포트는 본문·비교 자료를 파기해 생성 이력만
 * 남긴다(90일 뒤 매시 일이 지운다). 진행 중인 리포트 생성은 {@link AccountErasureStep#AI_JOBS} 자리가 닫는다. 남긴 좋아요·댓글은
 * 남아 "탈퇴한 사용자"로 보인다. 밀린 마감 집계는 계정이 아직 활성일 때 {@link PostgresChallengeWithdrawal} 이 먼저 한다.
 *
 * <p>트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다.
 */
@Repository
class PostgresChallengeAccountErasure implements AccountErasure {

    /** 이 계정을 가리키는 챌린지 자료. 한 줄이라도 있으면 계정 행을 지울 수 없다(외래 키에 ON DELETE 가 없다). */
    private static final List<String> RECORDS = List.of(
            "select c.hostUserId from ChallengeEntity c where c.hostUserId = :userId",
            "select e.userId from ChallengeEntryEntity e where e.userId = :userId",
            "select l.userId from EntryLikeEntity l where l.userId = :userId",
            "select c.userId from EntryCommentEntity c where c.userId = :userId",
            "select r.reporterId from EntryReportEntity r where r.reporterId = :userId",
            "select s.userId from EntrySaveEntity s where s.userId = :userId",
            "select v.userId from EntryViewEventEntity v where v.userId = :userId",
            "select b.blockerId from UserBlockEntity b where b.blockerId = :userId or b.blockedId = :userId",
            "select n.userId from NotificationEntity n where n.userId = :userId or n.actorUserId = :userId",
            "select r.userId from EntryAiReportEntity r where r.userId = :userId",
            "select s.viewerId from EntryRankingSnapshotEntity s where s.viewerId = :userId",
            "select p.userId from NotificationPushEntity p where p.userId = :userId");

    private final EntityManager entityManager;

    PostgresChallengeAccountErasure(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return EnumSet.of(AccountErasureStep.CHALLENGE);
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        UUID userId = account.userId();
        entityManager.createQuery("update ChallengeEntity c set c.hostUserId = null where c.hostUserId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
        entityManager.createQuery("delete from UserBlockEntity b where b.blockerId = :userId or b.blockedId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
        entityManager.createQuery("delete from EntrySaveEntity s where s.userId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
        entityManager.createQuery("delete from NotificationEntity n where n.userId = :userId")
                .setParameter("userId", userId)
                .executeUpdate();
        entityManager.createQuery("""
                        update ChallengeEntryEntity e
                        set e.visibility = :hidden, e.updatedAt = :now
                        where e.userId = :userId and e.status <> :deleted
                        """)
                .setParameter("hidden", ChallengeEntryVisibility.PRIVATE)
                .setParameter("deleted", ChallengeEntryStatus.DELETED)
                .setParameter("now", account.now())
                .setParameter("userId", userId)
                .executeUpdate();
        entityManager.createQuery("""
                        update EntryAiReportEntity r
                        set r.result = null, r.purgedAt = coalesce(r.purgedAt, :now)
                        where r.userId = :userId
                        """)
                .setParameter("now", account.now())
                .setParameter("userId", userId)
                .executeUpdate();
        return List.of();
    }

    @Override
    public boolean hasRecords(UUID userId) {
        return RECORDS.stream().anyMatch(query -> !entityManager.createQuery(query, UUID.class)
                .setParameter("userId", userId)
                .setMaxResults(1)
                .getResultList()
                .isEmpty());
    }
}
