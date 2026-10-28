package com.acttub.actingapi.feature.reading.app;

import java.time.Clock;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.SessionRatingStore.Rating;
import com.acttub.actingapi.feature.reading.app.SessionRatingStore.Saved;
import com.acttub.actingapi.platform.text.InputCharset;
import com.acttub.actingapi.platform.web.ApiException;

/**
 * 리딩 회차 평가 (reading.session, SOMA-661) — "이번 리딩 어땠나요?" 에서 좋았어요·아쉬웠어요를 누르는 순간 서버에
 * 회차 단위로 남긴다. 노트 평가(practice.note, {@code coach/app/NoteRatingService})와 같은 규칙이다.
 *
 * <p>한 줄은 선택이고 같은 행에 붙는다. 앞뒤 공백을 걷은 1~100자(코드 포인트)이고 비었으면 없는 것이다.
 * 같은 회차에 다시 누르면 덮어쓰며, 기기는 실패한 요청을 같은 요청 id 로 다시 보낸다.
 *
 * <p>게이트·소유권은 회차 조회({@code GET /v2/reading/sessions/{id}})와 같다: 없는 회차·남의 회차는 같은 404
 * {@code session_not_found} 다. 진행 중 회차도 받는다 — 나가기로 끝낸 회차에도 물을 수 있다. 평가는 회차 상태를
 * 바꾸지 않는다.
 */
public class SessionRatingService {

    public static final int COMMENT_MAX_CHARS = 100;

    private final SessionRatingStore store;
    private final Clock clock;

    public SessionRatingService(SessionRatingStore store, Clock clock) {
        this.store = store;
        this.clock = clock;
    }

    /**
     * @param rating 값 목록({@code good}·{@code bad})은 요청 DTO 가 이미 봤다
     * @param comment 다듬기 전의 한 줄. {@code null} 이면 없음
     */
    public Rating rate(UUID userId, UUID sessionId, UUID requestId, String rating, String comment) {
        InputCharset.require(comment);
        String trimmed = comment == null ? null : comment.strip();
        String normalized = trimmed == null || trimmed.isEmpty() ? null : trimmed;
        if (normalized != null && normalized.codePointCount(0, normalized.length()) > COMMENT_MAX_CHARS) {
            throw new ApiException(422, "comment_too_long");
        }
        Saved saved = store.save(userId, sessionId, requestId, rating, normalized, clock.instant());
        return switch (saved.outcome()) {
            case SAVED, REPLAYED -> saved.rating();
            case MISMATCH -> throw new ApiException(422, "request_fingerprint_mismatch");
            case SESSION_NOT_FOUND -> throw new ApiException(404, "session_not_found");
            // 게이트를 지난 뒤 다른 기기의 탈퇴(게스트는 이관)가 끝났다 — 닫힌 계정에 새 평가를 남기지 않는다.
            case INACTIVE -> throw new ApiException(403, "account_deactivated");
        };
    }

    /** 그 회차에 이 사람이 남긴 평가. 없으면 {@code null} — 회차 조회의 {@code my_rating}. */
    public Rating mine(UUID userId, UUID sessionId) {
        return store.mine(userId, sessionId);
    }
}
