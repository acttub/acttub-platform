package com.acttub.actingapi.feature.reading.app;

import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.domain.RecordingCoachMaterial;

/**
 * 리딩 녹음 코치(reading.recording-coach, 실험)의 저장 — {@code reading_recording_coaches} (V48)와, 재료로 읽는 회차·줄·녹음.
 *
 * <p>대화는 회차마다 하나다. 두 요청이 같은 회차로 겹치면 먼저 넣은 쪽이 남고 늦은 쪽은 그것을 돌려받는다.
 */
public interface RecordingCoachRepository {

    /** 내 회차의 구간 줄과 줄마다 마지막 녹음. 남의 회차·없는 회차는 {@code null}. */
    Material material(UUID userId, UUID sessionId);

    /** 그 회차의 대화. 없으면 {@code null}. */
    Coach findBySession(UUID userId, UUID sessionId);

    /** 내 대화. 없거나 남의 것이면 {@code null}. */
    Coach find(UUID userId, UUID coachId);

    /**
     * 첫 차례를 남긴다. 같은 회차에 이미 있으면 그것을, 그사이 회차가 지워졌으면 {@code null} 을 돌려준다.
     */
    Coach insertFirst(UUID userId, UUID sessionId, FirstTurn first, Instant now);

    /**
     * 배우 답과 둘째 차례를 남긴다. 이미 답이 있으면 바꾸지 않고 지금 값을 돌려준다. 없거나 남의 것이면 {@code null}.
     */
    Coach saveSecond(UUID userId, UUID coachId, String actorReply, String secondMessage, Instant now);

    record Material(Set<UUID> myCharacterIds, List<RecordingCoachMaterial.Line> lines,
                    List<RecordingCoachMaterial.Recording> recordings) {
    }

    /**
     * @param design 배우에게 보이지 않는 숨은 칸(검토용으로만 남긴다)
     * @param focusLineId 코치가 고른 녹음의 줄. 못 골랐으면 {@code null}
     */
    record FirstTurn(String model, int clipCount, String design, String message, UUID focusLineId) {
    }

    record Coach(
            UUID id,
            UUID sessionId,
            UUID focusLineId,
            String focusLineText,
            String firstMessage,
            String actorReply,
            String secondMessage,
            Instant createdAt,
            Instant updatedAt) {
    }
}
