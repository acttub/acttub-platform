package com.acttub.actingapi.feature.community.adapter.db;

import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountErasure;
import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import com.acttub.actingapi.feature.community.app.CommunityImageCleanup;
import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

/**
 * 계정을 닫을 때 게시판 글 사진의 행을 지운다 (account.withdraw, SOMA-873).
 *
 * <p>글과 댓글의 행은 남아 "탈퇴한 사용자"로 보인다. 사진은 행을 지워 글에서 빠지게 한다(붙지 않은 올리기 포함). 사진 객체의
 * 삭제는 행을 지우기 전에 키를 읽어 정리 장부에 올린다. 사진은 보관 동의와 무관하게 지운다.
 *
 * <p>트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다.
 */
@Repository
class PostgresCommunityAccountErasure implements AccountErasure {

    /** 이 계정을 가리키는 게시판 자료. 한 줄이라도 있으면 계정 행을 지울 수 없다(외래 키에 ON DELETE 가 없다). */
    private static final List<String> RECORDS = List.of(
            "select p.id from CommunityPostEntity p where p.authorId = :userId",
            "select c.id from CommunityCommentEntity c where c.authorId = :userId",
            "select l.id from CommunityPostLikeEntity l where l.userId = :userId",
            "select i.id from CommunityPostImageEntity i where i.uploaderId = :userId",
            "select a.id from CommunityAnonymousAliasEntity a where a.userId = :userId",
            "select r.id from CommunityReportEntity r where r.reporterId = :userId",
            "select b.id from CommunityBlockEntity b where b.blockerId = :userId or b.blockedId = :userId");

    private final EntityManager entityManager;
    private final CommunityImageCleanup cleanups;

    PostgresCommunityAccountErasure(EntityManager entityManager, CommunityImageCleanup cleanups) {
        this.entityManager = entityManager;
        this.cleanups = cleanups;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return EnumSet.of(AccountErasureStep.COMMUNITY_IMAGES);
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        List<String> imageKeys = entityManager
                .createQuery("select i.objectKey from CommunityPostImageEntity i where i.uploaderId = :userId", String.class)
                .setParameter("userId", account.userId())
                .getResultList();
        List<UUID> scheduled = imageKeys.isEmpty()
                ? List.of()
                : List.of(cleanups.schedule(account.userId(), imageKeys, account.now(), account.now()));
        entityManager.createQuery("delete from CommunityPostImageEntity i where i.uploaderId = :userId")
                .setParameter("userId", account.userId())
                .executeUpdate();
        return scheduled;
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
