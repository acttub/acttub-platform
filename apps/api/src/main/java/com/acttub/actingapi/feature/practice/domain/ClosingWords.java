package com.acttub.actingapi.feature.practice.domain;

import java.util.List;

/**
 * 대화가 끝날 때 배우가 한 말 — 코치가 정리한 핸드오프의 {@code actor_words} 와, 배우가 그
 * 정리를 확인했는지·부인했다면 무엇이라 했는지.
 *
 * <p>처음 적은 막힘({@code blockage_detail})과 나란히 놓는 것이 "배우 자신의 말이 바뀌었다"
 * 를 보여 주는 유일한 판정 없는 방법이다. 부인한 경우 반박문이 오른쪽에 간다 — "AI 가 틀렸고
 * 내가 맞았다" 도 배우의 말이다.
 */
public record ClosingWords(List<String> actorWords, boolean confirmed, String rebuttal) {

    public ClosingWords {
        actorWords = actorWords == null ? List.of() : List.copyOf(actorWords);
    }
}
