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
        List<String> sceneHistory,
        // 같은 묶음 앞선 회차에서 실제로 들린 대사. 이어서 찍은 테이크가 같은 장면인지 코드가 비교하는 데만 쓴다
        // (SOMA-636). 모델에게 직접 넘기지 않는다 — 지난 대사를 보여 주면 모델이 이번 영상에서도 들었다고 지어낸다.
        @com.fasterxml.jackson.annotation.JsonIgnore List<String> previousLines) {

    public static final PriorContext EMPTY =
            new PriorContext(Map.of(), null, true, List.of(), List.of());

    public PriorContext {
        memory = Map.copyOf(new LinkedHashMap<>(memory));
        pendingTakes = List.copyOf(pendingTakes);
        sceneHistory = List.copyOf(sceneHistory);
        previousLines = previousLines == null ? List.of() : List.copyOf(previousLines);
    }

    public PriorContext(Map<String, String> memory, String earlierConversation, boolean fromSamePractice,
            List<String> pendingTakes, List<String> sceneHistory) {
        this(memory, earlierConversation, fromSamePractice, pendingTakes, sceneHistory, List.of());
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
        return new PriorContext(kept, earlierConversation, fromSamePractice, pendingTakes, sceneHistory, previousLines);
    }

    /**
     * 직접 영상 코치(연습 루프)에 넘기는 사본. 자주 짚인 버릇({@code habits})·막히는 지점({@code blockage})과 옛 화법 두 칸을 뺀다.
     *
     * <p>이 칸들은 대부분 지난 코치의 짐작이다. 운영 기억에 "혼자 감정에 빠져 대사를 읊는 모습이 관찰됐다"처럼
     * 코치 진단이 배우의 사실로 저장돼 있었고, 다음 연습의 코치가 그것을 읽고 같은 진단으로 끌려갔다(2026-10-13 운영
     * DB·로컬 재생). 막히는 지점 기억도 대부분 모델이 쓴 칸이라 같은 진단이 섞여 있었다. 이번 연습에서 배우가 고른 막힌 곳은
     * 따로 들어간다. 근본 문제는 이번 영상에서만 고른다. 배우가 아니라고 한 것({@code avoid})·목표·바라는 것·말투는 남긴다.
     */
    public PriorContext withoutCoachGuesses() {
        Map<String, String> kept = new LinkedHashMap<>(memory);
        kept.remove("habits");
        kept.remove("blockage");
        kept.remove("speech_self");
        kept.remove("speech_actual");
        return new PriorContext(kept, earlierConversation, fromSamePractice, pendingTakes, sceneHistory, previousLines);
    }

    /** 기억 갱신이 쓰는 "이 배우에게 맞춘 코칭" 칸의 이름(SOMA-795). 기억 블록이 아니라 코치 성격 자리로 붙는다. */
    public static final String COACHING_PROFILE = "coaching_profile";

    /** 이 배우에게 맞춘 코칭. 없으면 빈 문자열. */
    public String coachingProfile() {
        String value = memory.get(COACHING_PROFILE);
        return value == null ? "" : value.strip();
    }

    /** 맞춤 코칭을 뺀 사본 — 기억 블록은 이 칸을 싣지 않는다. 같은 글이 두 번 실리면 모델이 그 글을 사실 목록으로 읽는다. */
    public PriorContext withoutCoachingProfile() {
        if (!memory.containsKey(COACHING_PROFILE)) return this;
        Map<String, String> kept = new LinkedHashMap<>(memory);
        kept.remove(COACHING_PROFILE);
        return new PriorContext(kept, earlierConversation, fromSamePractice, pendingTakes, sceneHistory, previousLines);
    }

    public boolean isEmpty() {
        return memory.isEmpty() && earlierConversation == null && pendingTakes.isEmpty()
                && sceneHistory.isEmpty();
    }
}
