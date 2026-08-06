package com.acttub.actingapi.report;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonPropertyOrder;

/**
 * {@code acting_report/schema.py} 의 {@code ActingReport}.
 *
 * <p>{@code comparison} 은 Python 에서 {@code default=""} 다 — 컬럼도
 * {@code DEFAULT ''::text NOT NULL} 이라 null 로 두면 NOT NULL 위반이다 (/SPEC.md §5-3-3).
 */
@JsonPropertyOrder({"headline", "biggest_problem", "evidence", "self_discovery",
        "encouragement", "next_step", "comparison"})
public record ActingReportPayload(
        @JsonProperty("headline") String headline,
        @JsonProperty("biggest_problem") BiggestProblem biggestProblem,
        @JsonProperty("evidence") String evidence,
        @JsonProperty("self_discovery") String selfDiscovery,
        @JsonProperty("encouragement") String encouragement,
        @JsonProperty("next_step") String nextStep,
        @JsonProperty("comparison") String comparison) {

    public ActingReportPayload {
        if (comparison == null) {
            comparison = "";
        }
    }
}
