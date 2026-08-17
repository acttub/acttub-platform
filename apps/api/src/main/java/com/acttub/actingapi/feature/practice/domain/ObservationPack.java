package com.acttub.actingapi.feature.practice.domain;

import java.util.List;
import java.util.UUID;

/**
 * 세션 하나에 대한 최신 관찰 묶음. {@code summaries} 의 가장 최근 행에서 온다.
 *
 * <p>{@code observation} 패키지에 이름이 같은 레코드가 따로 있고, 그 중복은 의도한 것이다 —
 * feature 끼리 직접 import 하지 않기로 했으므로(ADR-017) 각자 자기 도메인의 모양을 갖는다.
 * 합치려면 공유 위치와 소유자를 먼저 정해야 한다.
 */
public record ObservationPack(
        UUID summaryId,
        List<Observation> observations,
        List<String> uncertainties) {

    /**
     * 빈 묶음을 null 이 아니라 빈 리스트로 받는다. 이 레코드는 어댑터가 세우는 자리이고, 관찰이
     * 아직 없는 요약 행은 JSONB 가 비어 온다. 여기서 NPE 를 내면 "관찰이 없다" 가 500 이 된다.
     */
    public ObservationPack {
        observations = observations == null ? List.of() : List.copyOf(observations);
        uncertainties = uncertainties == null ? List.of() : List.copyOf(uncertainties);
    }
}
