package com.acttub.actingapi.feature.memory.app;

import java.time.Instant;
import java.util.UUID;

/**
 * 1.0.0 배우 기억의 채워진 한 칸 — {@code actor_memories} (practice.memory).
 *
 * <p>칸은 넷이다(goal·blockage·speech_self·speech_actual). 성별·나이는 프로필로 옮겼다
 * (account.profile) — 옛 여섯 칸짜리 {@link MemoryEntry} 와 다른 것이다.
 *
 * <p>{@code writtenByActor} 가 참이면 배우가 직접 쓰거나 고친 칸이라 워커가 덮지 않는다.
 * {@code sourcePracticeId} 는 <b>출처 연습이 보일 때만</b> 채운다 — 묶음이 숨겨졌으면 값은 그대로고
 * 링크만 없다(practice.memory 규칙).
 */
public record ActorMemory(
        String field,
        String value,
        boolean writtenByActor,
        UUID sourcePracticeId,
        Instant updatedAt) {
}
