package com.acttub.actingapi.feature.push.app;

import java.time.Instant;
import java.time.LocalDate;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public interface EveningReminderRepository {
    List<ReminderTarget> claimTargets(LocalDate day, Instant dayStart, Instant dayEnd, Instant recentSince,
                                      String minimumAppVersion);

    /**
     * 회원마다 가장 최근 연습 노트의 "다음 촬영에서 해볼 한 가지" (SOMA-704). 가장 최근 노트에 그것이 없거나,
     * {@code since} 뒤로 노트가 없거나, 숨긴 회차의 노트면 맵에 넣지 않는다.
     */
    Map<UUID, NextTake> latestNextTakes(Collection<UUID> userIds, Instant since);

    /** @param practiceId 노트가 나온 회차 — 관측 기록을 묶는 열쇠로 쓴다 */
    record NextTake(UUID practiceId, String text) {}
}
