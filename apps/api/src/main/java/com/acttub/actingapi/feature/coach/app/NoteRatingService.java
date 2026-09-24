package com.acttub.actingapi.feature.coach.app;

import java.time.Clock;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.app.NoteRatingStore.Rating;
import com.acttub.actingapi.feature.coach.app.NoteRatingStore.Saved;
import com.acttub.actingapi.platform.web.ApiException;
import org.springframework.stereotype.Service;

/**
 * 연습 노트 평가 (practice.note) — 노트에서 "도움 됐어요·아쉬웠어요" 를 누르는 순간 서버에 노트 단위로 남긴다.
 *
 * <p>한 줄은 선택이고 같은 행에 붙는다. 앞뒤 공백을 걷은 1~100자(코드 포인트)이고 비었으면 없는 것이다.
 * 같은 노트에 다시 누르면 덮어쓰며, 기기는 실패한 요청을 같은 요청 id 로 다시 보낸다.
 *
 * <p>게이트·소유권은 노트 조회({@code GET /v2/practices/{id}/note})와 같다: 없는 회차·남의 회차·노트가 아직 없는
 * 회차는 모두 같은 404 {@code note_not_found} 다. 평가는 노트·대화 상태를 바꾸지 않는다.
 */
@Service
public class NoteRatingService {

    public static final int COMMENT_MAX_CHARS = 100;

    private final NoteRatingStore store;
    private final Clock clock;

    public NoteRatingService(NoteRatingStore store, Clock clock) {
        this.store = store;
        this.clock = clock;
    }

    /**
     * @param rating 값 목록({@code helpful}·{@code not_helpful})은 요청 DTO 가 이미 봤다
     * @param comment 다듬기 전의 한 줄. {@code null} 이면 없음
     */
    public Rating rate(UUID userId, UUID practiceId, UUID requestId, String rating, String comment) {
        String trimmed = comment == null ? null : comment.strip();
        String normalized = trimmed == null || trimmed.isEmpty() ? null : trimmed;
        if (normalized != null && normalized.codePointCount(0, normalized.length()) > COMMENT_MAX_CHARS) {
            throw new ApiException(422, "comment_too_long");
        }
        Saved saved = store.save(userId, practiceId, requestId, rating, normalized, clock.instant());
        return switch (saved.outcome()) {
            case SAVED, REPLAYED -> saved.rating();
            case MISMATCH -> throw new ApiException(422, "request_fingerprint_mismatch");
            case NOTE_NOT_FOUND -> throw new ApiException(404, "note_not_found");
            // 게이트를 지난 뒤 다른 기기의 탈퇴가 끝났다 — 닫힌 계정에 새 평가를 남기지 않는다.
            case INACTIVE -> throw new ApiException(403, "account_deactivated");
        };
    }

    /** 그 노트에 이 사람이 남긴 평가. 없으면 {@code null} — 노트 조회의 {@code my_rating}. */
    public Rating mine(UUID userId, UUID noteId) {
        return store.mine(userId, noteId);
    }
}
