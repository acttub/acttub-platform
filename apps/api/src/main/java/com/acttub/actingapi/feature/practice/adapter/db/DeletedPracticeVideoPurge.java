package com.acttub.actingapi.feature.practice.adapter.db;

import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.video.app.PracticeGroupVideos;
import com.acttub.actingapi.feature.video.app.PracticeGroupVideos.GroupVideo;
import com.acttub.actingapi.feature.video.app.VideoObjectCleanup;
import com.acttub.actingapi.platform.persistence.NativeTuples;
import jakarta.persistence.EntityManager;
import jakarta.persistence.Tuple;
import org.springframework.stereotype.Repository;

/**
 * 지운 연습에서 보관 동의로 남긴 영상({@code deleted_practice_videos})과 무료 횟수 표시({@code practice_deletion_marks})의
 * 뒤처리 (practice.library 「연습 삭제」, SOMA-985).
 *
 * <p>영상 행을 고치는 것은 video 다({@link PracticeGroupVideos}). 여기는 어느 영상을 파기할지 고르고 객체 삭제를 장부에 올린다.
 * <b>트랜잭션을 열지 않는다</b> — 탈퇴의 트랜잭션이나 매일 정리가 여는 트랜잭션에 참여한다.
 */
@Repository
class DeletedPracticeVideoPurge {

    /**
     * 보관 문서의 현재 버전에 대한 마지막 결정이 동의인가. {@code %s} 자리에 사람 id 의 SQL 식을 넣는다. 한 사람의 판정은
     * consent 가 답하지만({@code auth/app/MediaRetention}), 여기는 지운 영상을 고르는 한 문장 안에서 행마다 봐야 해 식으로 둔다.
     * 현재 버전에 답하지 않았으면 거절로 본다 — 동의 없이 얼굴을 남기지 않는 쪽이 안전하다.
     */
    private static final String RETENTION_GRANTED = """
            EXISTS(SELECT 1
                   FROM (SELECT id
                         FROM consent_documents
                         WHERE type='retention'
                         ORDER BY published_at DESC,id DESC
                         LIMIT 1) current_document
                   JOIN LATERAL (SELECT action
                                 FROM user_consents
                                 WHERE user_consents.user_id=%s
                                   AND user_consents.document_id=current_document.id
                                 ORDER BY occurred_at DESC,id DESC
                                 LIMIT 1) last_decision ON true
                   WHERE last_decision.action='granted')
            """;

    private static final Duration MARK_RETENTION = Duration.ofDays(40);

    private final EntityManager entityManager;
    private final PracticeGroupVideos videos;
    private final VideoObjectCleanup cleanups;

    DeletedPracticeVideoPurge(EntityManager entityManager, PracticeGroupVideos videos, VideoObjectCleanup cleanups) {
        this.entityManager = entityManager;
        this.videos = videos;
        this.cleanups = cleanups;
    }

    /**
     * 보관하던 지운 영상의 파일을 파기한다 — 지운 날부터 3년이 지났거나({@code deletedBefore}) 원래 주인의 보관 동의 현재 버전
     * 결정이 동의가 아니면(거절로 바꿈·새 버전에 아직 답하지 않음·탈퇴하며 거절). 함께 40일 지난 무료 횟수 표시를 지운다.
     *
     * @return 장부에 올린 객체 삭제들
     */
    List<UUID> purgeExpired(Instant deletedBefore, Instant now) {
        entityManager.createNativeQuery("DELETE FROM practice_deletion_marks WHERE deleted_at<:cutoff")
                .setParameter("cutoff", now.minus(MARK_RETENTION).atOffset(ZoneOffset.UTC))
                .executeUpdate();
        return purge(NativeTuples.list(entityManager.createNativeQuery("""
                SELECT d.video_id,d.user_id,v.object_key,v.poster_key,v.purged_at
                FROM deleted_practice_videos d
                JOIN videos v ON v.id=d.video_id
                WHERE d.deleted_at<:cutoff
                """ + "   OR NOT " + RETENTION_GRANTED.formatted("d.user_id") + """
                ORDER BY d.deleted_at,d.video_id
                LIMIT 500
                FOR UPDATE OF d,v
                """, Tuple.class)
                .setParameter("cutoff", deletedBefore.atOffset(ZoneOffset.UTC))), now);
    }

    /** 탈퇴하며 보관에 동의하지 않은 사람이 앞서 지운 연습의 영상도 지금 파기한다. */
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

    /** 탈퇴하면 무료 횟수 표시는 쓸 데가 없다. */
    void forgetMarksOf(UUID userId) {
        entityManager.createNativeQuery("DELETE FROM practice_deletion_marks WHERE user_id=:userId")
                .setParameter("userId", userId)
                .executeUpdate();
    }

    private List<UUID> purge(List<Tuple> rows, Instant now) {
        List<UUID> scheduled = new ArrayList<>();
        for (Tuple row : rows) {
            GroupVideo video = new GroupVideo(
                    row.get("video_id", UUID.class),
                    row.get("object_key", String.class),
                    row.get("poster_key", String.class),
                    row.get("purged_at", Instant.class) != null);
            if (!video.purged()) {
                videos.purgeFile(video.id(), now);
                scheduled.add(cleanups.scheduleObjectDelete(row.get("user_id", UUID.class), video.objectKeys(), now, now));
            }
            entityManager.createNativeQuery("DELETE FROM deleted_practice_videos WHERE video_id=:videoId")
                    .setParameter("videoId", video.id())
                    .executeUpdate();
        }
        return List.copyOf(scheduled);
    }
}
