package com.acttub.actingapi.feature.memory.app;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.ActorMemoryField;

/**
 * memory 가 자기 저장소에 요구하는 것 (ADR-017).
 *
 * <p><b>없음은 {@code null} 로 알린다</b>(ADR-018). 이 포트의 실패 갈래는 연산마다 하나뿐이라
 * {@code practice} 와 같은 쪽으로 간다 — 갈래가 가장 많은 {@link #writeAsAgent} 도 "배우가
 * 손댄 칸이라 건너뛰었다" 하나이고, 그것을 예외로 만들면 정상 흐름을 예외로 다루게 된다
 * (연습마다 여러 칸이 그렇게 건너뛰어진다).
 */
public interface MemoryRepository {

    /** 채워진 칸만 돌아온다 — 빈 칸은 행이 없으므로 여섯 개보다 적을 수 있다. */
    List<MemoryEntry> list(UUID userId);

    /** 배우가 직접 쓰거나 고친다. 항상 이긴다. */
    MemoryEntry writeAsActor(UUID userId, ActorMemoryField field, String value);

    /**
     * 에이전트가 갱신한다.
     *
     * @return 배우가 손댄 칸이거나 에이전트가 쓸 수 없는 칸이면 {@code null} — 부르는 쪽이
     *         "덮어썼다" 고 착각하지 않게 하려는 것이다
     */
    MemoryEntry writeAsAgent(
            UUID userId, ActorMemoryField field, String value, UUID sourcePracticeSessionId);

    /** {@code field} 가 {@code null} 이면 그 배우의 기억을 통째로 지운다. */
    void delete(UUID userId, ActorMemoryField field);

    /** 갱신 잡이 읽을 재료. 연습이 지워졌으면 {@code null}. */
    MemoryUpdateMaterial material(UUID practiceSessionId);
}
