package com.acttub.actingapi.feature.reading.domain;

import java.util.List;
import java.util.UUID;

/**
 * 회차를 시작할 때 정하는 속성 — 뒤에 바꾸지 않는다 (reading.cast · reading.session).
 *
 * @param myCharacterIds 내 배역(하나 이상, 모두 그 대본의 배역). 나머지가 상대역이다
 * @param mode {@code read}(읽어주기)·{@code quiz}(암기 대조)
 * @param startLineId 구간의 시작 대사 줄(포함)
 * @param endLineId 구간의 끝 대사 줄(포함)
 * @param advance {@code silence}(침묵 감지)·{@code manual}(버튼)
 * @param record 내 차례 녹음을 켰는가
 */
public record SessionPlan(
        List<UUID> myCharacterIds,
        String mode,
        UUID startLineId,
        UUID endLineId,
        String advance,
        boolean record) {

    public SessionPlan {
        myCharacterIds = List.copyOf(myCharacterIds);
    }
}
