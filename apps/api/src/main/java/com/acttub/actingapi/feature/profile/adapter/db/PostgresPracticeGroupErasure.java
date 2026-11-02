package com.acttub.actingapi.feature.profile.adapter.db;

import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.practice.app.PracticeGroupErasure;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 연습 삭제의 구현 (practice.library 「연습 삭제」, SOMA-985). 탈퇴처럼 남의 표를 함께 치므로 정리 장부와 보관 동의를 가진
 * 이 저장소 묶음에 둔다.
 *
 * <p><b>사람과 끊어 남기는 방법.</b> 회차·노트 평가·의견·작업 행의 {@code user_id} 를 「지운 연습 보관 계정」
 * ({@link #DELETED_PRACTICE_OWNER}, 신원·프로필이 없는 비활성 계정)으로 바꾼다. 분석·대화·노트는 회차를 따라가므로 함께
 * 떠난다. 모든 조회가 {@code user_id} 로 주인을 고르므로 지운 묶음은 목록·상세·이어하기 어디에도 다시 나오지 않는다.
 * 그 계정은 첫 삭제 때 만든다 — 탈퇴 시각이 없어 3년 파기({@code purgeRetained})가 고르지 않는다.
 *
 * <p>잠그는 순서는 탈퇴와 같다: {@code users} → 영상 → 회차. 회차를 만드는 쪽도 영상 행을 먼저 잡는다.
 */
@Repository
class PostgresPracticeGroupErasure implements PracticeGroupErasure {

    /** 지운 연습을 들고 있는 계정. 로그인할 신원이 없고 상태는 {@code deactivated} 다. */
    static final UUID DELETED_PRACTICE_OWNER = UUID.fromString("00000000-0000-4000-8000-00000000de1e");

    private final EntityManager entityManager;
    private final TransactionTemplate transaction;
    private final PostgresObjectCleanupLedger cleanups;

    PostgresPracticeGroupErasure(
            EntityManager entityManager,
            PlatformTransactionManager transactionManager,
            PostgresObjectCleanupLedger cleanups) {
        this.entityManager = entityManager;
        this.transaction = new TransactionTemplate(transactionManager);
        this.cleanups = cleanups;
    }

    @Override
    public List<UUID> erase(UUID userId, UUID rootId, Instant now) {
        return transaction.execute(tx -> {
            if (NativeTuples.list(entityManager.createNativeQuery(
                    "SELECT id FROM users WHERE id=:userId AND status='active' FOR UPDATE", Tuple.class)
                    .setParameter("userId", userId)).isEmpty()) {
                return null;
            }
            // 영상을 먼저 잡는다 — 회차 시작·이어하기와 겹쳐도 순서가 정해진다.
            List<Tuple> videos = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT id,object_key,poster_key,purged_at
                    FROM videos
                    WHERE user_id=:userId
                      AND id IN (SELECT video_id FROM practices WHERE root_id=:rootId AND user_id=:userId)
                    ORDER BY id
                    FOR UPDATE
                    """, Tuple.class)
                    .setParameter("userId", userId)
                    .setParameter("rootId", rootId));
            List<Tuple> practices = NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT id,created_at,reading_session_id
                    FROM practices
                    WHERE root_id=:rootId AND user_id=:userId
                    ORDER BY ordinal
                    FOR UPDATE
                    """, Tuple.class)
                    .setParameter("rootId", rootId)
                    .setParameter("userId", userId));
            if (practices.stream().noneMatch(row -> rootId.equals(row.get("id", UUID.class)))) {
                return null;
            }
            List<UUID> practiceIds = practices.stream().map(row -> row.get("id", UUID.class)).toList();
            ensureOwner(now);

            for (Tuple practice : practices) {
                entityManager.createNativeQuery("""
                        INSERT INTO practice_deletion_marks(id,user_id,practice_created_at,from_reading,deleted_at)
                        VALUES (:id,:userId,:createdAt,:fromReading,:now)
                        """)
                        .setParameter("id", UUID.randomUUID())
                        .setParameter("userId", userId)
                        .setParameter("createdAt", practice.get("created_at", Instant.class).atOffset(ZoneOffset.UTC))
                        .setParameter("fromReading", practice.get("reading_session_id", UUID.class) != null)
                        .setParameter("now", at(now))
                        .executeUpdate();
            }

            // 진행 중인 분석·기억 갱신은 멈춘다 — 돌던 워커의 완료는 lease 가 맞지 않아 저장되지 않는다.
            entityManager.createNativeQuery("""
                    UPDATE ai_jobs
                    SET status='failed',failure_reason='practice_deleted',
                        lease_token=NULL,lease_expires_at=NULL,result=NULL,updated_at=:now
                    WHERE user_id=:userId
                      AND status IN ('pending','running')
                      AND (target_id IN (:practiceIds)
                           OR target_id IN (SELECT id FROM coach_conversations WHERE practice_id IN (:practiceIds)))
                    """)
                    .setParameter("now", at(now))
                    .setParameter("userId", userId)
                    .setParameter("practiceIds", practiceIds)
                    .executeUpdate();
            entityManager.createNativeQuery("""
                    UPDATE ai_jobs
                    SET user_id=:owner,updated_at=:now
                    WHERE user_id=:userId
                      AND (target_id IN (:practiceIds)
                           OR target_id IN (SELECT id FROM coach_conversations WHERE practice_id IN (:practiceIds)))
                    """)
                    .setParameter("owner", DELETED_PRACTICE_OWNER)
                    .setParameter("now", at(now))
                    .setParameter("userId", userId)
                    .setParameter("practiceIds", practiceIds)
                    .executeUpdate();

            // 배우가 직접 쓴 글은 사람과 끊어도 그 사람을 드러낼 수 있어 남기지 않는다(탈퇴와 같다).
            entityManager.createNativeQuery("DELETE FROM actor_journals WHERE practice_id IN (:practiceIds)")
                    .setParameter("practiceIds", practiceIds)
                    .executeUpdate();
            entityManager.createNativeQuery("""
                    UPDATE note_ratings
                    SET comment=NULL,user_id=:owner,updated_at=:now
                    WHERE practice_id IN (:practiceIds)
                    """)
                    .setParameter("owner", DELETED_PRACTICE_OWNER)
                    .setParameter("now", at(now))
                    .setParameter("practiceIds", practiceIds)
                    .executeUpdate();
            entityManager.createNativeQuery("""
                    UPDATE practice_feedback
                    SET contact_email=NULL,contact_phone=NULL,user_id=:owner,
                        sheet_seq=sheet_seq+1,sheet_synced_at=NULL,updated_at=:now
                    WHERE practice_id IN (:practiceIds)
                    """)
                    .setParameter("owner", DELETED_PRACTICE_OWNER)
                    .setParameter("now", at(now))
                    .setParameter("practiceIds", practiceIds)
                    .executeUpdate();
            // 이 묶음에서 나온 기억은 코치가 다시 꺼내지 않게 지운다. 다른 연습에서 나온 기억은 그대로다.
            entityManager.createNativeQuery("""
                    DELETE FROM actor_memories
                    WHERE user_id=:userId
                      AND (source_practice_id IN (:practiceIds) OR scene_root_id=:rootId)
                    """)
                    .setParameter("userId", userId)
                    .setParameter("practiceIds", practiceIds)
                    .setParameter("rootId", rootId)
                    .executeUpdate();

            List<UUID> scheduled = new ArrayList<>();
            List<String> keys = new ArrayList<>();
            boolean retain = RetentionDecisions.granted(entityManager, userId);
            for (Tuple video : videos) {
                UUID videoId = video.get("id", UUID.class);
                if (usedOutsideGroup(videoId, rootId)) {
                    continue;
                }
                if (video.get("purged_at", Instant.class) == null) {
                    if (retain) {
                        entityManager.createNativeQuery("""
                                INSERT INTO deleted_practice_videos(video_id,user_id,deleted_at)
                                VALUES (:videoId,:userId,:now)
                                ON CONFLICT (video_id) DO NOTHING
                                """)
                                .setParameter("videoId", videoId)
                                .setParameter("userId", userId)
                                .setParameter("now", at(now))
                                .executeUpdate();
                    } else {
                        keys.addAll(purgeFile(videoId, video, now));
                    }
                }
                entityManager.createNativeQuery("""
                        UPDATE videos SET user_id=:owner,favorite=false,updated_at=:now WHERE id=:videoId
                        """)
                        .setParameter("owner", DELETED_PRACTICE_OWNER)
                        .setParameter("now", at(now))
                        .setParameter("videoId", videoId)
                        .executeUpdate();
            }
            if (!keys.isEmpty()) {
                scheduled.add(cleanups.schedule(userId, keys, now, now));
            }

            entityManager.createNativeQuery("""
                    UPDATE practices
                    SET user_id=:owner,favorite=false,updated_at=:now
                    WHERE root_id=:rootId AND user_id=:userId
                    """)
                    .setParameter("owner", DELETED_PRACTICE_OWNER)
                    .setParameter("now", at(now))
                    .setParameter("rootId", rootId)
                    .setParameter("userId", userId)
                    .executeUpdate();
            return List.copyOf(scheduled);
        });
    }

    @Override
    public void attempt(List<UUID> operationIds) {
        cleanups.attempt(operationIds);
    }

    /**
     * 보관하던 지운 영상의 파일을 파기한다 — 지운 날부터 3년이 지났거나({@code deletedBefore}) 원래 주인의 보관 동의
     * 현재 판 결정이 동의가 아니면(거절로 바꿈·새 판에 아직 답하지 않음·탈퇴하며 거절). 매일 정리가 부른다.
     * 함께 40일 지난 무료 횟수 표시를 지운다.
     *
     * @return 장부에 올린 객체 삭제들
     */
    List<UUID> purgeExpired(Instant deletedBefore, Instant now) {
        return transaction.execute(tx -> {
            entityManager.createNativeQuery("DELETE FROM practice_deletion_marks WHERE deleted_at<:cutoff")
                    .setParameter("cutoff", at(now.minus(java.time.Duration.ofDays(40))))
                    .executeUpdate();
            return purge(NativeTuples.list(entityManager.createNativeQuery("""
                    SELECT d.video_id,d.user_id,v.object_key,v.poster_key,v.purged_at
                    FROM deleted_practice_videos d
                    JOIN videos v ON v.id=d.video_id
                    WHERE d.deleted_at<:cutoff
                    """ + "   OR NOT " + RetentionDecisions.GRANTED_SQL.formatted("d.user_id") + """
                    ORDER BY d.deleted_at,d.video_id
                    LIMIT 500
                    FOR UPDATE OF d,v
                    """, Tuple.class)
                    .setParameter("cutoff", at(deletedBefore))), now);
        });
    }

    /**
     * 탈퇴하며 보관에 동의하지 않은 사람이 앞서 지운 연습의 영상도 지금 파기한다. 탈퇴의 트랜잭션 안에서 부른다
     * — 자기 트랜잭션을 열지 않는다.
     */
    List<UUID> purgeAllOf(UUID userId, Instant now) {
        return purge(NativeTuples.list(entityManager.createNativeQuery("""
                SELECT d.video_id,d.user_id,v.object_key,v.poster_key,v.purged_at
                FROM deleted_practice_videos d
                JOIN videos v ON v.id=d.video_id
                WHERE d.user_id=:userId
                ORDER BY d.video_id
                FOR UPDATE OF d,v
                """, Tuple.class)
                .setParameter("userId", userId)), now);
    }

    /** 탈퇴하면 무료 횟수 표시는 쓸 데가 없다. 탈퇴의 트랜잭션 안에서 부른다. */
    void forgetMarks(UUID userId) {
        entityManager.createNativeQuery("DELETE FROM practice_deletion_marks WHERE user_id=:userId")
                .setParameter("userId", userId)
                .executeUpdate();
    }

    private List<UUID> purge(List<Tuple> rows, Instant now) {
        List<UUID> scheduled = new ArrayList<>();
        for (Tuple row : rows) {
            UUID videoId = row.get("video_id", UUID.class);
            UUID owner = row.get("user_id", UUID.class);
            if (row.get("purged_at", Instant.class) == null) {
                List<String> keys = purgeFile(videoId, row, now);
                scheduled.add(cleanups.schedule(owner, keys, now, now));
            }
            entityManager.createNativeQuery("DELETE FROM deleted_practice_videos WHERE video_id=:videoId")
                    .setParameter("videoId", videoId)
                    .executeUpdate();
        }
        return List.copyOf(scheduled);
    }

    /** 파일만 파기와 같다(practice.library): 받아쓰기를 지우고 purged_at 을 찍고 객체 키를 돌려준다. */
    private List<String> purgeFile(UUID videoId, Tuple video, Instant now) {
        entityManager.createNativeQuery("DELETE FROM video_transcripts WHERE video_id=:videoId")
                .setParameter("videoId", videoId)
                .executeUpdate();
        entityManager.createNativeQuery("UPDATE videos SET purged_at=:now,updated_at=:now WHERE id=:videoId")
                .setParameter("now", at(now))
                .setParameter("videoId", videoId)
                .executeUpdate();
        Set<String> keys = new LinkedHashSet<>();
        keys.add(video.get("object_key", String.class));
        String poster = video.get("poster_key", String.class);
        if (poster != null) {
            keys.add(poster);
        }
        return List.copyOf(keys);
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

    private void ensureOwner(Instant now) {
        entityManager.createNativeQuery("""
                INSERT INTO users(id,status,created_at,updated_at,retention_purged_at)
                VALUES (:id,'deactivated',:now,:now,:now)
                ON CONFLICT (id) DO NOTHING
                """)
                .setParameter("id", DELETED_PRACTICE_OWNER)
                .setParameter("now", at(now))
                .executeUpdate();
    }

    private static java.time.OffsetDateTime at(Instant instant) {
        return instant.atOffset(ZoneOffset.UTC);
    }
}
