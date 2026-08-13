package com.acttub.actingapi.summary;

import com.fasterxml.jackson.annotation.JsonProperty;

public record ObservationItem(
        @JsonProperty("start_ms") long startMs,
        @JsonProperty("end_ms") long endMs,
        String label,
        double confidence) {
}
