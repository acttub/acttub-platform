package com.acttub.actingapi.feature.memory.app;

import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.platform.schema.ActorMemoryField;

/**
 * memory 가 자기 저장소에 요구하는 것 (ADR-017).
 *
 * <p>옛 표({@code actor_memory_entries})를 다룬다. 이 표에 에이전트로 쓰던 옛 기억 갱신 워커는 SOMA-1140 에서 지웠다.
 */
public interface MemoryRepository {

    /** 채워진 칸만 돌아온다 — 빈 칸은 행이 없으므로 여섯 개보다 적을 수 있다. */
    List<MemoryEntry> list(UUID userId);

    /** 배우가 직접 쓰거나 고친다. 항상 이긴다. */
    MemoryEntry writeAsActor(UUID userId, ActorMemoryField field, String value);

    /** {@code field} 가 {@code null} 이면 그 배우의 기억을 통째로 지운다. */
    void delete(UUID userId, ActorMemoryField field);
}
