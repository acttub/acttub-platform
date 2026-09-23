package com.acttub.actingapi.feature.memory.app;

import java.util.List;
import java.util.UUID;

/**
 * 1.0.0 배우 기억의 저장소 — {@code actor_memories} 와 {@code users.memory_epoch} (practice.memory, ADR-017).
 *
 * <p>옛 {@link MemoryRepository}({@code actor_memory_entries}, 여섯 칸)와 다른 포트다. 배우 쪽 경로만 여기를
 * 지나고, 워커가 쓰는 길은 {@link ActorMemoryUpdates} 다 — 지나는 규칙이 다르다(배우 것을 덮지 않는다,
 * 예약한 세대와 다르면 아무것도 쓰지 않는다).
 *
 * <p><b>기억 세대(memory_epoch)가 늦은 갱신을 막는다.</b> 삭제와 이관 선택이 세대를 올리고, 갱신 작업은 예약
 * 시점의 세대를 들고 있다가 완료 때 다르면 반영하지 않는다 — 지운 기억이 되살아나거나 버린 쪽의 작업이 덮지
 * 못한다.
 */
public interface ActorMemoryStore {

    /** 채워진 칸만, 화면이 읽는 순서로. 빈 칸은 행이 없으므로 넷보다 적을 수 있다. */
    List<ActorMemory> list(UUID userId);

    /**
     * 배우가 한 칸을 쓰거나 고친다. 항상 이긴다({@code written_by = actor}).
     *
     * @return 계정이 활성이 아니면 {@code null} — 아무것도 쓰지 않는다
     */
    ActorMemory writeAsActor(UUID userId, String field, String value);

    /**
     * 기억을 지운다. <b>멱등이고 세대를 올린다</b> — 이미 없어도 지우려는 결과는 같다.
     *
     * @param field {@code null} 이면 그 배우의 기억을 통째로 지운다
     */
    void delete(UUID userId, String field);
}
