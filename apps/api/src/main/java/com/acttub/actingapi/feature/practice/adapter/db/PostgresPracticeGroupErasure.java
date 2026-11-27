package com.acttub.actingapi.feature.practice.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.auth.app.AccountRowLock;
import com.acttub.actingapi.feature.auth.app.DeletedPracticeAccount;
import com.acttub.actingapi.feature.auth.app.MediaRetention;
import com.acttub.actingapi.feature.practice.app.DeletedPracticePurge;
import com.acttub.actingapi.feature.practice.app.ErasedPracticeGroup;
import com.acttub.actingapi.feature.practice.app.PracticeGroupErasure;
import com.acttub.actingapi.feature.practice.app.PracticeGroupErasureSequence;
import com.acttub.actingapi.feature.video.app.PracticeGroupVideos;
import com.acttub.actingapi.feature.video.app.PracticeGroupVideos.GroupVideo;
import com.acttub.actingapi.feature.video.app.VideoObjectCleanup;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 연습 삭제의 구현 (practice.library 「연습 삭제」, SOMA-985). 여기는 순서와 회차를 맡고, 다른 기능의 표는 그 주인이 고친다
 * (ADR-040): 보관 계정은 auth, 영상은 video, 작업·일지·평가·의견·기억은 {@link PracticeGroupErasureSequence} 의 자리마다 그 주인.
 *
 * <p><b>사람과 끊어 남기는 방법.</b> 회차·노트 평가·의견·작업 행의 {@code user_id} 를 「지운 연습 보관 계정」
 * ({@link DeletedPracticeAccount}, 신원·프로필이 없는 비활성 계정)으로 바꾼다. 분석·대화·노트는 회차를 따라가므로 함께
 * 떠난다. 모든 조회가 {@code user_id} 로 주인을 고르므로 지운 묶음은 목록·상세·이어하기 어디에도 다시 나오지 않는다.
 * 그 계정은 첫 삭제 때 만든다.
 *
 * <p>잠그는 순서는 탈퇴와 같다: {@code users} → 영상 → 회차. 회차를 만드는 쪽도 영상 행을 먼저 잡는다.
 */
@Repository
class PostgresPracticeGroupErasure implements PracticeGroupErasure, DeletedPracticePurge {

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final DeletedPracticeAccount keeperAccount;
    private final PracticeGroupVideos videos;
    private final PracticeGroupErasureSequence otherRecords;
    private final MediaRetention retention;
    private final VideoObjectCleanup cleanups;
    private final DeletedPracticeVideoPurge deletedVideos;

    private final AccountRowLock accountRows;

    PostgresPracticeGroupErasure(
            EntityManager entityManager,
            PlatformTransactionManager transactionManager,
            DeletedPracticeAccount keeperAccount,
            PracticeGroupVideos videos,
            PracticeGroupErasureSequence otherRecords,
            MediaRetention retention,
            VideoObjectCleanup cleanups,
            DeletedPracticeVideoPurge deletedVideos,
            AccountRowLock accountRows) {
        this.accountRows = accountRows;
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.keeperAccount = keeperAccount;
        this.videos = videos;
        this.otherRecords = otherRecords;
        this.retention = retention;
        this.cleanups = cleanups;
        this.deletedVideos = deletedVideos;
    }

    @Override
    public List<UUID> erase(UUID userId, UUID rootId, Instant now) {
        return transaction.execute(tx -> {
            if (!accountRows.lockActive(userId)) {
                return null;
            }
            // 영상을 먼저 잡는다 — 회차 시작·이어하기와 겹쳐도 순서가 정해진다.
            List<GroupVideo> groupVideos = videos.lockOf(userId, rootId);
            List<Object[]> practices = entityManager.createQuery("""
                            select p.id, p.createdAt, p.readingSessionId
                            from PracticeEntity p
                            where p.rootId = :rootId and p.userId = :userId
                            order by p.ordinal
                            """, Object[].class)
                    .setParameter("rootId", rootId)
                    .setParameter("userId", userId)
                    .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                    .getResultList();
            List<UUID> practiceIds = practices.stream().map(row -> (UUID) row[0]).toList();
            if (!practiceIds.contains(rootId)) {
                return null;
            }
            UUID keeper = keeperAccount.ensure(now);

            // 지운 회차의 시각은 남겨 오늘 쓴 무료 코칭 횟수에서 빠지지 않게 한다.
            for (Object[] practice : practices) {
                entityManager.createNativeQuery("""
                        INSERT INTO practice_deletion_marks(id,user_id,practice_created_at,from_reading,deleted_at)
                        VALUES (:id,:userId,:createdAt,:fromReading,:now)
                        """)
                        .setParameter("id", UUID.randomUUID())
                        .setParameter("userId", userId)
                        .setParameter("createdAt", ((Instant) practice[1]).atOffset(ZoneOffset.UTC))
                        .setParameter("fromReading", practice[2] != null)
                        .setParameter("now", now.atOffset(ZoneOffset.UTC))
                        .executeUpdate();
            }

            otherRecords.erase(new ErasedPracticeGroup(userId, rootId, practiceIds, keeper, now));

            List<String> keys = new ArrayList<>();
            boolean retain = retention.granted(userId);
            for (GroupVideo video : groupVideos) {
                if (usedOutsideGroup(video.id(), rootId)) {
                    continue;
                }
                if (!video.purged()) {
                    if (retain) {
                        entityManager.createNativeQuery("""
                                INSERT INTO deleted_practice_videos(video_id,user_id,deleted_at)
                                VALUES (:videoId,:userId,:now)
                                ON CONFLICT (video_id) DO NOTHING
                                """)
                                .setParameter("videoId", video.id())
                                .setParameter("userId", userId)
                                .setParameter("now", now.atOffset(ZoneOffset.UTC))
                                .executeUpdate();
                    } else {
                        videos.purgeFile(video.id(), now);
                        keys.addAll(video.objectKeys());
                    }
                }
                videos.handOver(video.id(), keeper, now);
            }
            List<UUID> scheduled = keys.isEmpty()
                    ? List.of()
                    : List.of(cleanups.scheduleObjectDelete(userId, keys, now, now));

            entityManager.createQuery("""
                            update PracticeEntity p
                            set p.userId = :keeper, p.favorite = false, p.updatedAt = :now
                            where p.rootId = :rootId and p.userId = :userId
                            """)
                    .setParameter("keeper", keeper)
                    .setParameter("now", now)
                    .setParameter("rootId", rootId)
                    .setParameter("userId", userId)
                    .executeUpdate();
            return scheduled;
        });
    }

    @Override
    public void attempt(List<UUID> operationIds) {
        cleanups.attemptObjectDelete(operationIds);
    }

    @Override
    public List<UUID> purgeExpired(Instant deletedBefore, Instant now) {
        return transaction.execute(tx -> deletedVideos.purgeExpired(deletedBefore, now));
    }

    /** 다른 묶음의 회차나 챌린지 참여작이 이 영상을 쓰면 영상은 보관함에 그대로 둔다. */
    private boolean usedOutsideGroup(UUID videoId, UUID rootId) {
        return !NativeTuples.list(entityManager.createNativeQuery("""
                SELECT 1 AS used WHERE EXISTS(SELECT 1 FROM practices WHERE video_id=:videoId AND root_id<>:rootId)
                   OR EXISTS(SELECT 1 FROM challenge_entries WHERE video_id=:videoId)
                """, Tuple.class)
                .setParameter("videoId", videoId)
                .setParameter("rootId", rootId)).isEmpty();
    }
}
