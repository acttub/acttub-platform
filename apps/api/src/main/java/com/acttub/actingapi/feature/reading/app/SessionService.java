package com.acttub.actingapi.feature.reading.app;

import java.time.Clock;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.SessionRepository.Progress;
import com.acttub.actingapi.feature.reading.app.SessionRepository.ProgressChange;
import com.acttub.actingapi.feature.reading.app.SessionRepository.Start;
import com.acttub.actingapi.feature.reading.app.SessionViews.ProgressView;
import com.acttub.actingapi.feature.reading.app.SessionViews.SessionCardView;
import com.acttub.actingapi.feature.reading.app.SessionViews.SessionDetailView;
import com.acttub.actingapi.feature.reading.domain.SessionPlan;
import com.acttub.actingapi.platform.web.ApiException;

/**
 * 리딩 회차의 규칙 — 내 배역·방식·구간·넘김·녹음을 정해 시작하고, 진행을 앞으로만 저장하고, 구간 끝을 지나면 완료하고,
 * 회차를 지운다 (reading.cast · reading.session).
 *
 * <p>값의 형태(필수 키·타입·값 목록)는 요청을 받는 자리가 보고 422 배열로 답한다. 여기서 거절하는 것은 <b>규칙</b>이고
 * 본문은 사유 코드 하나다: 내 배역 없음·남의 배역({@code invalid_characters}), 구간의 줄이 대사 줄이 아님·구간 밖 위치
 * ({@code invalid_line}), 순서 뒤집힘·내 대사 없는 구간({@code empty_range}), 같은 요청 id 에 다른 속성
 * ({@code request_fingerprint_mismatch}), 닫힌 회차에 진행 저장({@code session_closed}), 없는 것과 남의 것
 * ({@code script_not_found}·{@code session_not_found}).
 */
public class SessionService {

    private final SessionRepository sessions;
    private final ReadingRecordingCleanup cleanup;
    private final RecordingPlayback playback;
    private final Clock clock;

    public SessionService(
            SessionRepository sessions, ReadingRecordingCleanup cleanup, RecordingPlayback playback, Clock clock) {
        this.sessions = sessions;
        this.cleanup = cleanup;
        this.playback = playback;
        this.clock = clock;
    }

    /**
     * 회차를 시작한다. 열린 회차가 있으면 같은 트랜잭션에서 {@code stopped} 로 닫는다("새로운 연습"). 연결이 끊겨 같은
     * 요청이 다시 오면 먼저 만든 회차를 돌려준다({@code created=false}).
     */
    public Started start(UUID userId, UUID scriptId, UUID requestId, SessionPlan plan) {
        Start start = sessions.start(userId, scriptId, requestId, plan, clock.instant());
        if (start == null) {
            throw new ApiException(404, "script_not_found");
        }
        switch (start.outcome()) {
            case REQUEST_MISMATCH -> throw new ApiException(422, "request_fingerprint_mismatch");
            case INVALID_CHARACTERS -> throw new ApiException(422, "invalid_characters");
            case INVALID_LINE -> throw invalidLine();
            case EMPTY_RANGE -> throw new ApiException(422, "empty_range");
            default -> { }
        }
        return new Started(find(userId, start.sessionId()), start.outcome() == SessionRepository.StartOutcome.CREATED);
    }

    /** 녹음에는 조회할 때마다 10분 서명 재생 주소를 붙인다(reading.recording). */
    public SessionDetailView find(UUID userId, UUID sessionId) {
        SessionDetailView session = sessions.find(userId, sessionId);
        if (session == null) {
            throw notFound();
        }
        return new SessionDetailView(
                session.card(), session.scriptId(), session.mode(), session.advance(), session.record(),
                session.startLineId(), session.endLineId(), session.currentLineId(), session.progressSeq(),
                session.lineResults(), playback.decorate(session.recordings()));
    }

    public List<SessionCardView> list(UUID userId, UUID scriptId) {
        List<SessionCardView> cards = sessions.list(userId, scriptId);
        if (cards == null) {
            throw new ApiException(404, "script_not_found");
        }
        return cards;
    }

    /**
     * 진행을 저장한다. {@code progress_seq} 가 저장된 값보다 클 때만 반영하고, 아니면 무시하고 현재 값을 돌려준다 —
     * 늦게 온 옛 요청이 최신을 덮지 못한다. 닫힌 회차는 409 {@code session_closed}.
     */
    public ProgressView saveProgress(UUID userId, UUID sessionId, ProgressChange change) {
        Progress progress = sessions.saveProgress(userId, sessionId, change, clock.instant());
        if (progress == null) {
            throw notFound();
        }
        return switch (progress.outcome()) {
            case CLOSED -> throw new ApiException(409, "session_closed");
            case INVALID_LINE -> throw invalidLine();
            default -> progress.view();
        };
    }

    /** 회차와 그 녹음(파일 포함)을 지운다. 암기 상태는 남는다. 객체 삭제는 장부가 커밋 뒤에 시도한다. */
    public void delete(UUID userId, UUID sessionId) {
        List<UUID> scheduled = sessions.delete(userId, sessionId, clock.instant());
        if (scheduled == null) {
            throw notFound();
        }
        cleanup.attempt(scheduled);
    }

    private static ApiException invalidLine() {
        return new ApiException(422, "invalid_line");
    }

    private static ApiException notFound() {
        return new ApiException(404, "session_not_found");
    }

    /** @param created 이번에 만들었으면 {@code true}, 같은 요청의 재전송이면 {@code false} */
    public record Started(SessionDetailView session, boolean created) {
    }
}
