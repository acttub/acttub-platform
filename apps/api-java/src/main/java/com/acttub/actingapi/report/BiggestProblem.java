package com.acttub.actingapi.report;

import com.fasterxml.jackson.annotation.JsonProperty;

/** {@code acting_report/schema.py} 의 {@code BiggestProblem}. */
public record BiggestProblem(
        @JsonProperty("start") String start,
        @JsonProperty("end") String end,
        @JsonProperty("dimension") String dimension,
        @JsonProperty("description") String description) {
}
