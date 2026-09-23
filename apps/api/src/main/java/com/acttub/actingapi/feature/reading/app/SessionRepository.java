package com.acttub.actingapi.feature.reading.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.SessionViews.ProgressView;
import com.acttub.actingapi.feature.reading.app.SessionViews.SessionCardView;
import com.acttub.actingapi.feature.reading.app.SessionViews.SessionDetailView;
import com.acttub.actingapi.feature.reading.domain.LineResult;
import com.acttub.actingapi.feature.reading.domain.SessionPlan;

/**
 * reading 이 저장소에 요구하는 것 — 리딩 회차 (reading.cast · reading.session).
 *
 * <p>없음을 {@code null} 로 알린다(ADR-018). "없는 것"과 "남의 것"을 가르지 않는다 — 모든 연산이 그 회원의 것만
 * 본다. 쓰기는 <b>회차(또는 대본) 행을 {@code FOR UPDATE} 로 잡고 주인이 맞는지 다시 본다</b> — 이관·탈퇴·삭제가
 * 먼저 끝났으면 행이 없거나 남의 것이라 404 이고 옛 계정에 아무것도 남지 않는다(03-reading 「리딩 자료의
 * 이관·삭제·탈퇴」). 이관은 게스트의 {@code users} 행을 잡은 뒤 리딩 행을 옮기므로 겹쳐도 순서가 정해진다.
 */
public interface SessionRepository {

    /**
     * 회차를 한 트랜잭션에서 시작한다 — 대본 행을 잠그고, 같은 (user_id, request_id) 가 있으면 그것으로 답하고
     * (속성이 같으면 {@link StartOutcome#REPLAYED}, 다르면 {@link StartOutcome#REQUEST_MISMATCH}), 내 배역·구간을
     * 확인한 뒤, 열린 회차를 {@code stopped} 로 바꾸고 새 회차를 만든다. 거절이면 아무것도 쓰지 않는다.
     *
     * @return 대본이 없거나 남의 것이면 {@code null}
     */
    Start start(UUID userId, UUID scriptId, UUID requestId, SessionPlan plan, Instant now);

    /** @param sessionId 만들었거나 먼저 만들어 둔 회차. 거절이면 {@code null} */
    record Start(UUID sessionId, StartOutcome outcome) {
    }

    enum StartOutcome {
        CREATED,
        REPLAYED,
        /** 같은 요청 id 에 다른 속성. */
        REQUEST_MISMATCH,
        /** 내 배역이 없거나, 겹치거나, 그 대본의 배역이 아니다. */
        INVALID_CHARACTERS,
        /** 구간의 줄이 그 대본의 대사 줄이 아니다. */
        INVALID_LINE,
        /** 시작 줄이 끝 줄 뒤이거나 구간 안에 내 대사가 없다. */
        EMPTY_RANGE
    }

    /** 없으면 {@code null}. */
    SessionDetailView find(UUID userId, UUID sessionId);

    /** 그 대본의 회차, 최근순. 대본이 없거나 남의 것이면 {@code null}(회차가 없으면 빈 목록). */
    List<SessionCardView> list(UUID userId, UUID scriptId);

    /**
     * 진행을 저장한다. 회차 행을 잠근 채 — 닫힌 회차면 {@link ProgressOutcome#CLOSED}, {@code progressSeq} 가 저장된
     * 값보다 크지 않으면 아무것도 바꾸지 않고 {@link ProgressOutcome#IGNORED}, 위치·결과의 줄이 구간 안 대사 줄이
     * 아니면 {@link ProgressOutcome#INVALID_LINE}. 반영하면 시간은 줄지 않고 줄 결과는 마지막 사건이 이긴다.
     *
     * @return 없거나 남의 것이면 {@code null}. 그 밖에는 언제나 <b>현재 값</b>을 함께 돌려준다
     */
    Progress saveProgress(UUID userId, UUID sessionId, ProgressChange change, Instant now);

    /**
     * @param currentLineId {@code null} 이면 위치는 그대로 둔다
     * @param elapsedSeconds {@code null} 이면 시간은 그대로 둔다
     * @param complete 구간 끝을 지났다 — completed, ended_at, 위치 NULL
     */
    record ProgressChange(
            long progressSeq, UUID currentLineId, Integer elapsedSeconds, List<LineResult> lineResults, boolean complete) {
    }

    /** @param view 거절({@code INVALID_LINE})이면 {@code null}, 그 밖에는 현재 값 */
    record Progress(ProgressView view, ProgressOutcome outcome) {
    }

    enum ProgressOutcome {
        APPLIED,
        IGNORED,
        CLOSED,
        INVALID_LINE
    }

    /**
     * 회차와 그 녹음 행을 지우고 녹음 객체의 삭제를 <b>같은 트랜잭션에서</b> 정리 장부에 올린다. 암기 상태는 남긴다.
     *
     * @return 장부에 올린 객체 삭제. 부르는 쪽이 트랜잭션 밖에서 시도한다. 없거나 남의 것이면 {@code null}
     */
    List<UUID> delete(UUID userId, UUID sessionId, Instant now);
}
