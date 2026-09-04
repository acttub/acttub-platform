package com.acttub.actingapi.integration.observation;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;

/**
 * 영상 관찰 한 묶음.
 *
 * <p>{@code sceneSummary} 는 장면 전체가 무슨 이야기인지다 — 구간 관찰만으로는 코치가
 * 장면을 통째로 알지 못해 매번 배우에게 맥락을 되물었다(SOMA-490).
 *
 * <p>필드 순서를 못박는 이유는 이 직렬화가 그대로 코치의 프롬프트가 되기 때문이다. 장면이
 * 무슨 이야기인지를 먼저 읽고 구간 관찰을 봐야 순서대로 읽힌다 — Jackson 의 기본 순서에
 * 맡기면 이름순으로 나가 {@code observations} 가 앞선다.
 */
@JsonPropertyOrder({"scene_summary", "observations", "uncertainties"})
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
