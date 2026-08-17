package com.acttub.actingapi.feature.coach.domain;

/**
 * 이번 연습 뒤에 배우의 기억을 갱신할 차례인지 (`memory_worker.py:should_update_memory`).
 *
 * <p>첫 연습에는 바로 채운다 — 그래야 두 번째 연습부터 코치가 쓸 것이 생긴다. 그 뒤로는 몇 번에
 * 한 번만 돈다. 매번 돌리면 한 번의 이상한 대화가 곧장 기억이 된다.
 */
public final class MemoryUpdateCadence {

    private static final int EVERY = 3;

    private MemoryUpdateCadence() {
    }

    public static boolean shouldUpdate(long confirmedPracticeCount) {
        if (confirmedPracticeCount <= 0) {
            return false;
        }
        if (confirmedPracticeCount == 1) {
            return true;
        }
        return confirmedPracticeCount % EVERY == 0;
    }
}
