package com.acttub.actingapi.feature.video.adapter.db;

import java.util.EnumSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountErasure;
import com.acttub.actingapi.feature.auth.app.AccountErasureStep;
import com.acttub.actingapi.feature.auth.app.ClosingAccount;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import org.springframework.stereotype.Repository;

/**
 * 계정을 닫을 때 보관함 영상을 파기한 것으로 적는다 (account.withdraw, specs/practice 「연습 자료의 이관·삭제·탈퇴」).
 *
 * <p><b>행을 지우지 않고</b> {@code purged_at} 을 찍는다 — 회차·참여작의 기록이 깨지지 않고, 재생이 막히며, 총량에서 빠진다.
 * 받아쓰기({@code video_transcripts})는 사람과 끊어 남긴다. 영상 객체의 키는 이 자리보다 앞선
 * {@link AccountErasureStep#MEDIA_OBJECTS} 자리가 읽어 장부에 올린다. 보관 동의자의 영상은 여기서 찍지 않고 탈퇴 3년 뒤의
 * 파기가 찍는다.
 *
 * <p>트랜잭션을 열지 않는다 — 계정을 닫는 트랜잭션에 참여한다.
 */
@Repository
class PostgresVideoAccountErasure implements AccountErasure {

    private final EntityManager entityManager;

    PostgresVideoAccountErasure(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Set<AccountErasureStep> steps() {
        return EnumSet.of(AccountErasureStep.VIDEO_FILES);
    }

    @Override
    public List<UUID> erase(AccountErasureStep step, ClosingAccount account) {
        // 먼저 이 사람의 영상 행을 잡는다 — 회차를 만드는 쪽이 같은 행을 잡으므로 겹쳐도 순서가 정해진다.
        entityManager.createQuery("select v.id from VideoEntity v where v.userId = :userId", UUID.class)
                .setParameter("userId", account.userId())
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .getResultList();
        if (!account.retainMedia()) {
            entityManager.createQuery("""
                            update VideoEntity v
                            set v.purgedAt = :now, v.updatedAt = :now
                            where v.userId = :userId and v.purgedAt is null
                            """)
                    .setParameter("now", account.now())
                    .setParameter("userId", account.userId())
                    .executeUpdate();
        }
        return List.of();
    }

    /** 영상과 올리기 예약의 행은 계정 행을 가리킨 채 남는다(외래 키에 ON DELETE 가 없다). */
    @Override
    public boolean hasRecords(UUID userId) {
        boolean videos = !entityManager.createQuery("select v.id from VideoEntity v where v.userId = :userId", UUID.class)
                .setParameter("userId", userId)
                .setMaxResults(1)
                .getResultList()
                .isEmpty();
        // 은퇴한 예약 장부(upload_intents)는 Schema Entity 가 없어 native 로 둔다(CONTRACT §5-1).
        return videos || !entityManager.createNativeQuery("SELECT 1 FROM upload_intents WHERE user_id=:userId LIMIT 1")
                .setParameter("userId", userId)
                .getResultList()
                .isEmpty();
    }
}
