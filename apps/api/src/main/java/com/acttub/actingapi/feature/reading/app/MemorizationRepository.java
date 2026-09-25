package com.acttub.actingapi.feature.reading.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * reading 이 저장소에 요구하는 것 — 암기 표시 (reading.memorization).
 *
 * <p>(사람, 줄)마다 상태 하나다. 없음을 {@code null} 로 알린다(ADR-018) — "없는 것"과 "남의 것"을 가르지 않는다. 갱신은
 * 그 줄이 속한 <b>대본 행을 잡고</b> 주인이 맞는지 다시 본다: 이관이 대본을 옮기는 사이에 커밋된 표시가 닫힌 게스트에게
 * 남지 않고, 이관·탈퇴·삭제가 먼저 끝났으면 남의 것이라 404 다.
 */
public interface MemorizationRepository {

    /**
     * 줄의 표시를 두거나 바꾼다. 같은 상태의 재전송은 {@code updated_at} 을 바꾸지 않는다({@link Outcome#UNCHANGED}).
     *
     * @param status {@code memorized}·{@code not_yet}
     * @return 그 줄이 없거나 남의 대본의 줄이면 {@code null}
     */
    Change set(UUID userId, UUID lineId, String status, Instant now);

    /** @param view {@code INVALID_LINE} 이면 {@code null} */
    record Change(Outcome outcome, MemorizationView view) {
    }

    enum Outcome {
        SAVED,
        UNCHANGED,
        /** 지문·장면 줄 — 대사 줄만 표시할 수 있다. */
        INVALID_LINE
    }

    /** 그 대본의 줄에 남긴 표시, 줄 순서. 대본이 없거나 남의 것이면 {@code null}(표시가 없으면 빈 목록). */
    List<MemorizationView> list(UUID userId, UUID scriptId);

    record MemorizationView(UUID lineId, String status, Instant updatedAt) {
    }
}
