package com.acttub.actingapi.coach.domain;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 이번 대화 전에 이미 있던 것들 (`acting-agent/schema.py:PriorContext`).
 *
 * <p>셋 다 없을 수 있다 — 첫 연습이 그렇다. 그때는 프롬프트에 칸을 아예 만들지 않는다.
 * <b>빈 제목만 있으면 모델이 그 자리를 지어내 채운다.</b>
 */
public record PriorContext(
        Map<String, String> memory, String earlierConversation, List<String> pendingTakes) {

    public static final PriorContext EMPTY = new PriorContext(Map.of(), null, List.of());

    public PriorContext {
        memory = Map.copyOf(new LinkedHashMap<>(memory));
        pendingTakes = List.copyOf(pendingTakes);
    }

    public boolean isEmpty() {
        return memory.isEmpty() && earlierConversation == null && pendingTakes.isEmpty();
    }
}
