package com.acttub.actingapi.feature.video.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.video.app.VideoViews.VideoPage;
import com.acttub.actingapi.feature.video.app.VideoViews.VideoView;

/**
 * video 가 저장소에 요구하는 것 — 보관함 (practice.record, practice.library).
 *
 * <p>없음을 {@code null} 로 알린다(ADR-018) — "없는 것"과 "남의 것"을 가르지 않는다.
 *
 * <p><b>총량 검사와 영상 확정은 사용자 행을 잠근 채 같은 트랜잭션에서 한다</b>(practice.record). 그래서 한도
 * 직전의 동시 업로드 둘 가운데 하나만 확정된다. 바깥 호출(객체 저장소)은 그 트랜잭션 밖이다(CONTRACT §5-4).
 */
public interface VideoRepository {

    /**
     * 올릴 자리를 예약한다({@code upload_intents}). 같은 요청 id 의 재전송은 같은 예약이고, 같은 id 에 다른
     * 본문이면 {@link ReserveOutcome#MISMATCH} 다.
     *
     * @param quotaBytes 계정의 보관 총량 상한. 이미 넘었으면 예약하지 않는다
     */
    Reserved reserve(UUID userId, NewIntent intent, long quotaBytes, Instant now);

    /**
     * @param fingerprint 요청 본문의 지문(형식·크기·길이). 같은 요청 id 의 재전송 판정에 쓴다
     */
    record NewIntent(
            UUID requestId,
            String fingerprint,
            String objectKey,
            String contentType,
            long byteSize,
            int durationMs,
            Instant expiresAt) {
    }

    /** @param objectKey 재전송이면 <b>먼저 예약한</b> 키다 — 부르는 쪽은 이 키로 주소를 다시 만든다 */
    record Reserved(ReserveOutcome outcome, UUID intentId, String objectKey, Instant expiresAt) {
    }

    enum ReserveOutcome {
        CREATED,
        /** 같은 요청 id·같은 지문. 먼저 만든 예약을 그대로 쓴다. */
        REPLAYED,
        /** 이미 총량을 넘겼다. */
        QUOTA,
        /** 같은 요청 id·다른 본문. */
        MISMATCH
    }

    /**
     * 예약 하나. 없거나 남의 것이면 {@code null}. 마무리는 이것을 먼저 읽어 객체 키를 얻는다 — 저장소에 묻는
     * 일은 트랜잭션 밖이라야 한다(§5-4).
     */
    IntentView findIntent(UUID userId, UUID intentId);

    /** @param videoId 이미 확정된 예약이면 그 영상. 아직이면 {@code null} */
    record IntentView(
            UUID id,
            UUID requestId,
            String objectKey,
            String contentType,
            long byteSize,
            int durationMs,
            Instant expiresAt,
            UUID videoId) {
    }

    /**
     * 예약을 확정해 보관함에 영상을 만든다. <b>사용자 행을 잠근 채</b> 총량을 다시 세고, 그 사이에 다른 요청이
     * 확정했으면 그 영상을 돌려준다({@link CompleteOutcome#REPLAYED}).
     *
     * @param stored 저장소에서 확인한 실제 객체. 크기가 예약과 다르면 {@link CompleteOutcome#SIZE_MISMATCH}
     * @param quotaBytes 계정의 보관 총량 상한. 이 확정으로 넘기면 {@link CompleteOutcome#QUOTA}
     */
    Completed complete(UUID userId, UUID intentId, VideoStorage.Stored stored, long quotaBytes, Instant now);

    /**
     * @param video 만들었거나(CREATED) 이미 있던(REPLAYED) 영상. 그 밖에는 {@code null}
     * @param cleanupOperationIds 버린 객체의 삭제를 장부에 올린 것(없으면 빈 목록)
     */
    record Completed(CompleteOutcome outcome, VideoView video, List<UUID> cleanupOperationIds) {
    }

    enum CompleteOutcome {
        CREATED,
        /** 이미 확정된 예약. 같은 영상이다. */
        REPLAYED,
        /** 없거나 남의 예약이다. */
        NOT_FOUND,
        /** 시한이 지났다 — 미확정 객체는 장부가 지운다. */
        EXPIRED,
        /** 이 확정이 총량을 넘긴다. */
        QUOTA,
        /** 올라온 객체의 크기가 예약과 다르다. */
        SIZE_MISMATCH
    }

    /**
     * 시한이 지난 예약 하나를 치우고 그 객체의 삭제를 장부에 올린다 — 마무리가 늦게 왔을 때다.
     *
     * @return 장부에 올린 것(이미 치웠거나 확정된 예약이면 빈 목록)
     */
    List<UUID> expireIntent(UUID userId, UUID intentId, Instant now);

    /**
     * 보관함 한 쪽. 최신 저장순이다.
     *
     * @param filter {@code all}·{@code recent7}·{@code favorite}
     * @param cursor 앞 쪽의 마지막 자리. 처음이면 {@code null}
     */
    VideoPage list(UUID userId, String filter, String cursor, int limit, Instant now);

    /** 영상 하나. 없거나 남의 것이면 {@code null}. */
    VideoView find(UUID userId, UUID videoId);

    /** 즐겨찾기를 바꾸고 바뀐 뒤를 돌려준다. 없거나 남의 것이면 {@code null}. */
    VideoView setFavorite(UUID userId, UUID videoId, boolean favorite, Instant now);

    /**
     * 영상을 지운다 — <b>참조가 없을 때만</b>. 행·받아쓰기를 지우고 객체 삭제를 같은 트랜잭션에서 장부에 올린다.
     * 참조 확인과 삭제는 영상 행을 잠근 채 한다(회차 시작과 겹쳐도 하나만 성공한다).
     */
    Removed delete(UUID userId, UUID videoId, Instant now);

    /**
     * 파일만 파기한다 — 회차·참여작의 기록은 남기고 객체·받아쓰기만 지운다({@code purged_at}). 총량에서 빠진다.
     * 이미 파기된 영상에 다시 걸면 같은 답이다.
     */
    Removed purgeFile(UUID userId, UUID videoId, Instant now);

    /** @param video {@code PURGED} 일 때 파기 뒤의 영상. 그 밖에는 {@code null} */
    record Removed(RemoveOutcome outcome, VideoView video, List<UUID> cleanupOperationIds) {
    }

    enum RemoveOutcome {
        DELETED,
        /** 파일만 파기했다. */
        PURGED,
        /** 회차나 참여작이 참조한다. */
        IN_USE,
        NOT_FOUND
    }

    /**
     * 시한이 지난 미확정 예약을 치우고 그 객체의 삭제를 장부에 올린다 (practice.record). 매일 도는 일이 부른다.
     *
     * @return 장부에 올린 것들
     */
    List<UUID> sweepExpiredIntents(Instant now);

    /**
     * 포스터가 없는 영상 하나를 집는다 — 최신 저장순이다(방금 올린 영상이 밀린 옛 영상보다 먼저다). 파기됐거나 활성
     * 계정의 것이 아니거나 이미 {@code maxAttempts} 번 집은 영상은 고르지 않는다. <b>집으면서 시도 횟수를 올리고
     * 커밋한다</b> — 도중에 죽은 시도도 센다.
     *
     * @return 없으면 {@code null}
     */
    PosterJob claimPoster(int maxAttempts);

    /** 포스터를 만들 영상 하나. {@code userId} 는 집을 때의 주인이다(이관되면 바뀔 수 있다). */
    record PosterJob(UUID videoId, UUID userId, String objectKey, int durationMs) {
    }

    /**
     * 올려 둔 포스터를 영상에 붙인다. <b>주인의 {@code users} 행을 먼저 잡고</b>(탈퇴·3년 파기와 같은 순서) 영상 행을
     * 잡는다. 그 사이에 영상이 지워졌거나 파기됐거나 주인이 바뀌었거나 계정이 활성이 아니면 붙이지 않고, 포스터 객체의
     * 삭제를 <b>같은 트랜잭션에서</b> 장부에 올린다 — 늦게 만든 포스터가 남지 않는다.
     *
     * @return 장부에 올린 것(붙였으면 빈 목록)
     */
    List<UUID> attachPoster(PosterJob job, String posterKey, Instant now);
}
