package com.acttub.actingapi.feature.reading.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.SessionViews.RecordingView;

/**
 * reading 이 저장소에 요구하는 것 — 줄 단위 녹음 (reading.recording).
 *
 * <p>올리기는 두 단계다. {@link #precheck} 는 변환·올리기 전에 잠그지 않고 본다(회차·줄·재전송·시도 번호) — 헛된 ffmpeg
 * 실행을 막는다. {@link #store} 는 객체를 올린 뒤 <b>회차 행을 잠근 채</b> 같은 것을 다시 보고 총량까지 확인해 행을 만들거나
 * 대체한다. 반영하지 못한 객체(거절·재전송·대체된 앞의 것)의 키는 같은 트랜잭션에서 정리 장부에 올린다
 * ({@link ReadingRecordingCleanup}) — 커밋 뒤 저장소가 실패해도 키를 잃지 않는다.
 *
 * <p>없음을 {@code null}·{@code NOT_FOUND} 로 알린다(ADR-018). "없는 것"과 "남의 것"을 가르지 않는다. 이관·탈퇴·삭제가
 * 먼저 끝났으면 회차가 없거나 남의 것이라 404 이고 옛 계정에 아무것도 남지 않는다.
 */
public interface RecordingRepository {

    Precheck precheck(UUID userId, UUID sessionId, UUID lineId, UUID requestId, int attemptNo);

    /** @param current {@code REPLAYED}·{@code IGNORED} 일 때 돌려줄 현재 행 */
    record Precheck(PrecheckOutcome outcome, RecordingView current) {
    }

    enum PrecheckOutcome {
        OK,
        NOT_FOUND,
        /** 그 회차의 구간 안 내 대사 줄이 아니다. */
        INVALID_LINE,
        /** 같은 요청 id 의 행이 이미 있다. */
        REPLAYED,
        /** 같은 줄에 더 큰(같은) 시도 번호가 이미 있다. */
        IGNORED
    }

    /**
     * @param quotaBytes 계정의 저장 총량 상한. 대체되는 앞 녹음의 바이트는 빼고 센다
     */
    Stored store(UUID userId, UUID sessionId, NewRecording recording, long quotaBytes, Instant now);

    /** @param byteSize 변환 뒤 크기 */
    record NewRecording(
            UUID requestId,
            UUID lineId,
            int attemptNo,
            String objectKey,
            String contentType,
            long byteSize,
            int durationMs,
            String transcript,
            String transcriptSource,
            Boolean matched) {
    }

    /**
     * @param recording 만들었거나 대체했거나 이미 있던 행. {@code NOT_FOUND}·{@code INVALID_LINE}·{@code QUOTA} 면 {@code null}
     * @param cleanupOperationIds 같은 트랜잭션에서 장부에 올린 객체 삭제. 부르는 쪽이 트랜잭션 밖에서 시도한다
     */
    record Stored(StoreOutcome outcome, RecordingView recording, List<UUID> cleanupOperationIds) {
    }

    enum StoreOutcome {
        CREATED,
        /** 같은 줄의 앞 녹음을 대체했다. 앞 객체는 장부에 있다. */
        REPLACED,
        REPLAYED,
        IGNORED,
        NOT_FOUND,
        INVALID_LINE,
        /** 총량을 넘는다. 기존은 그대로고 올린 객체는 장부에 있다. */
        QUOTA
    }

    /**
     * 행을 지우고 객체 삭제를 같은 트랜잭션에서 장부에 올린다. 회차 진행·암기 상태는 건드리지 않는다.
     *
     * @return 장부에 올린 객체 삭제. 없거나 남의 것이면 {@code null}
     */
    List<UUID> delete(UUID userId, UUID recordingId, Instant now);
}
