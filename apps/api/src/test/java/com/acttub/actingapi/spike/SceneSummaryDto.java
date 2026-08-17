package com.acttub.actingapi.spike;

import java.util.List;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * {@code acting_summary/schema.py} 의 {@code SceneSummary} 형상.
 *
 * <p>스파이크 전용이다 — 파이프라인 이식이 아니라 <b>구조화 출력이 스키마를 지키는지</b>만 본다.
 * unknown key 를 거부하는 ObjectMapper 로 읽어서, Gemini 가 스키마 밖 필드를 흘리면 파싱이 깨지게 한다.
 */
record SceneSummaryDto(
        @JsonProperty("observation") Observation observation,
        @JsonProperty("summary") String summary,
        @JsonProperty("intent_alignment") String intentAlignment,
        @JsonProperty("key_moment") String keyMoment,
        @JsonProperty("key_dimension") String keyDimension,
        @JsonProperty("anomalies") List<Anomaly> anomalies) {

    record Observation(
            @JsonProperty("timeline") String timeline,
            @JsonProperty("dialogue") String dialogue,
            @JsonProperty("tempo") String tempo,
            @JsonProperty("pitch") String pitch,
            @JsonProperty("movement") String movement,
            @JsonProperty("expression") String expression,
            @JsonProperty("emotion") String emotion,
            @JsonProperty("extra") List<ExtraDimension> extra) {
    }

    record ExtraDimension(
            @JsonProperty("name") String name,
            @JsonProperty("observation") String observation) {
    }

    record Anomaly(
            @JsonProperty("start") String start,
            @JsonProperty("end") String end,
            @JsonProperty("dimension") String dimension,
            @JsonProperty("what") String what,
            @JsonProperty("why_odd") String whyOdd,
            @JsonProperty("likely_cause") String likelyCause,
            @JsonProperty("impact_on_intent") String impactOnIntent,
            @JsonProperty("overlaps_key_moment") Boolean overlapsKeyMoment,
            @JsonProperty("on_key_dimension") Boolean onKeyDimension,
            @JsonProperty("intent_impact") String intentImpact,
            @JsonProperty("severity") String severity,
            @JsonProperty("severity_reason") String severityReason) {
    }
}
