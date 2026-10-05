package com.acttub.actingapi.feature.coach.app;

import java.time.Instant;
import java.util.List;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * 같은 배우가 앞서 나눈 연습 루프 대화 하나의 원재료(배우.md의 재료).
 *
 * <p>저장소는 저장된 상태·턴·노트를 그대로 읽어 오기만 한다. 요약하지 않는다 — 모델이 요약하면 틀린 기억이
 * 굳고, 배우가 그것을 고칠 화면이 없다. 무엇을 남길지는 {@link PracticeLoopMemory} 가 코드로 정한다.
 *
 * @param createdAt 대화가 시작된 시각
 * @param loopState {@code coaching_state.practice_loop} (설계·턴별 상태)
 * @param turns 저장된 대화 턴 (코치 본문과 배우 원문)
 * @param nextTake 그 대화 노트의 다음 촬영 제안. 없으면 {@code null}
 */
public record PastPracticeLoop(Instant createdAt, JsonNode loopState, List<Turn> turns, String nextTake) {

    /** 저장된 턴 하나. 다른 도메인(memory)이 채우므로 coach 의 domain 타입을 쓰지 않는다(ADR-019). */
    public record Turn(String role, String text) {}

    public PastPracticeLoop {
        turns = turns == null ? List.of() : List.copyOf(turns);
    }
}
