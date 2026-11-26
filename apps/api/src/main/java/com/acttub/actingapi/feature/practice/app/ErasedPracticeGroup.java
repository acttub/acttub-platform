package com.acttub.actingapi.feature.practice.app;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

/**
 * 지우는 연습 묶음 (practice.library 「연습 삭제」).
 *
 * @param userId 묶음의 주인
 * @param rootId 묶음의 첫 회차
 * @param practiceIds 묶음의 회차 전부
 * @param keeper 사람과 끊어 남기는 기록을 넘겨받는 「지운 연습 보관 계정」
 */
public record ErasedPracticeGroup(UUID userId, UUID rootId, List<UUID> practiceIds, UUID keeper, Instant now) {
    public ErasedPracticeGroup {
        practiceIds = List.copyOf(practiceIds);
    }
}
