package com.acttub.actingapi.memory.app;

import java.util.UUID;

/**
 * 기억 여섯 칸 중 채워진 한 칸.
 *
 * <p>{@code writtenByActor} 가 참이면 배우가 직접 쓰거나 고친 칸이라 에이전트가 덮지 않는다.
 * {@code sourcePracticeSessionId} 는 에이전트가 적은 칸이 어느 연습에서 나왔는지이며,
 * 배우가 쓴 칸에서는 비어 있다.
 */
public record MemoryEntry(
        String field,
        String value,
        boolean writtenByActor,
        UUID sourcePracticeSessionId) {
}
