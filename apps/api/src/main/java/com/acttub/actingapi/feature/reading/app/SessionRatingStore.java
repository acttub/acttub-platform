package com.acttub.actingapi.feature.reading.app;

import java.time.Instant;
import java.util.UUID;

/**
 * 리딩 회차 평가의 저장소 — {@code reading_session_ratings} (reading.session, V40).
 *
 * <p>회차 하나에 사람 하나가 한 행이고 다시 누르면 덮어쓴다. 행이 가진 {@code request_id} 는 마지막으로 반영한
 * 요청이다 — 같은 id 의 재전송은 저장된 값과 견줘 같으면 그대로 돌려주고 다르면 지문 불일치다. 노트 평가
 * ({@code coach/app/NoteRatingStore})와 같은 모양이다.
 */
public interface SessionRatingStore {

    /**
     * 평가를 남기거나 덮어쓴다. 계정 확인·회차 찾기·멱등 판정·쓰기가 한 트랜잭션이다.
     *
     * @param comment 다듬은 한 줄. 없으면 {@code null} — 덮어쓸 때 한 줄도 비운다
     */
    Saved save(UUID userId, UUID sessionId, UUID requestId, String rating, String comment, Instant now);

    /** 그 회차에 이 사람이 남긴 평가. 없으면 {@code null}. */
    Rating mine(UUID userId, UUID sessionId);

    record Rating(String rating, String comment, Instant updatedAt) {
    }

    enum Outcome {
        /** 새로 남겼거나 덮어썼다. */
        SAVED,
        /** 같은 요청의 재전송 — 아무것도 바꾸지 않았다. */
        REPLAYED,
        /** 같은 요청 id 에 다른 본문. */
        MISMATCH,
        /** 없는 회차이거나 이 사람의 회차가 아니다. */
        SESSION_NOT_FOUND,
        /** 게이트를 지난 뒤 탈퇴·이관이 끝났다. */
        INACTIVE
    }

    /** @param rating {@link Outcome#SAVED}·{@link Outcome#REPLAYED} 일 때만 있다 */
    record Saved(Outcome outcome, Rating rating) {
    }
}
