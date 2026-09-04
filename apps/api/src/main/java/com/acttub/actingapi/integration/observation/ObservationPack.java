package com.acttub.actingapi.integration.observation;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * 영상 관찰 한 묶음.
 *
 * <p>{@code sceneSummary} 는 장면 전체가 무슨 이야기인지다 — 구간 관찰만으로는 코치가
 * 장면을 통째로 알지 못해 매번 배우에게 맥락을 되물었다(SOMA-490).
 */
public record ObservationPack(
        @JsonProperty("scene_summary") String sceneSummary,
        List<ObservationItem> observations,
        List<String> uncertainties) {

    public ObservationPack {
        sceneSummary = sceneSummary == null ? "" : sceneSummary;
        observations = observations == null ? List.of() : List.copyOf(observations);
        uncertainties = uncertainties == null ? List.of() : List.copyOf(uncertainties);
    }
}
