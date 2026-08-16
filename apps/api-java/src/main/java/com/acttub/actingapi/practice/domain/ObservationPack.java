package com.acttub.actingapi.practice.domain;

import java.util.List;
import java.util.UUID;

/** 세션 하나에 대한 최신 관찰 묶음. {@code summaries} 의 가장 최근 행에서 온다. */
public record ObservationPack(
        UUID summaryId,
        List<Observation> observations,
        List<String> uncertainties) {

    public ObservationPack {
        observations = List.copyOf(observations);
        uncertainties = List.copyOf(uncertainties);
    }
}
