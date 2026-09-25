package com.acttub.actingapi.feature.coach.app;

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
        Map<String, String> memory,
        String earlierConversation,
        // 발췌가 이 연습의 지난 대화인지(true), 다른 연습의 직전 대화인지(false).
        // 프롬프트 제목이 갈린다 — 다른 연습의 대화를 "같은 연습" 이라고 붙이면
        // 코치가 이번 영상의 장면과 뒤섞는다.
        boolean fromSamePractice,
        List<String> pendingTakes,
        // 이어한 묶음(부모+자식들)에서 차수별 카드 한 줄 요약. 직전 대화 6턴만으로는
        // 3~4차째에 처음 찾은 것을 잃는다 — 카드는 이미 요약이라 모델 호출 없이 조립한다.
        List<String> sceneHistory) {

    public static final PriorContext EMPTY =
            new PriorContext(Map.of(), null, true, List.of(), List.of());

    public PriorContext {
        memory = Map.copyOf(new LinkedHashMap<>(memory));
        pendingTakes = List.copyOf(pendingTakes);
        sceneHistory = List.copyOf(sceneHistory);
    }

    /**
     * 성별·나이를 뺀 사본. 배우가 저장한 완성된 프로필이 있을 때 <b>모델에 넘기는 쪽</b>에만 쓴다 —
     * 같은 것을 두 번 말하지 않고, 낡은 기억이 지금 값과 다투지 않게 한다. 저장된 기억은 그대로다.
     *
     * <p>목표({@code goal})는 남긴다. 기억의 목표는 배우가 말한 자유 서술이고 프로필의 최종 목표는 셋
     * 중 하나라 결이 다르다 — 서로 보완한다.
     */
    public PriorContext withoutDemographics() {
        Map<String, String> kept = new LinkedHashMap<>(memory);
        kept.remove("gender");
        kept.remove("age");
        return new PriorContext(kept, earlierConversation, fromSamePractice, pendingTakes, sceneHistory);
    }

    public boolean isEmpty() {
        return memory.isEmpty() && earlierConversation == null && pendingTakes.isEmpty()
                && sceneHistory.isEmpty();
    }
}
