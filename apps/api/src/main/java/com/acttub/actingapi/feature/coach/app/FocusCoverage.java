package com.acttub.actingapi.feature.coach.app;

import java.util.HashSet;
import java.util.Set;
import com.fasterxml.jackson.databind.JsonNode;

/** Temporal guard only: semantic relevance still requires model evaluation. Legacy focus stays local. */
final class FocusCoverage {
    private FocusCoverage() { }
    static void validate(JsonNode focus, JsonNode record, JsonNode view) {
        if (!"whole_video".equals(focus.path("scope").asText())) return;
        require(!"isolated".equals(focus.path("pattern").asText()), "whole-video focus cannot be isolated");
        require("ready".equals(record.path("processing").path("status").asText())
                && record.path("processing").path("missing_ranges").isEmpty(),
                "analysis has missing ranges; use local focus");
        Set<String> delivered = new HashSet<>();
        view.path("source_catalog").forEach(source -> delivered.add(source.path("id").asText()));
        for (String group : new String[]{"events", "limitations"}) {
            for (JsonNode fact : record.path(group)) require(delivered.contains(fact.path("id").asText()),
                    "whole-video focus requires all observations and limitations; lookup more or use local");
        }
        Set<String> refs = new HashSet<>();
        focus.path("evidence_refs").forEach(ref -> refs.add(ref.asText()));
        long duration = record.path("media").path("duration_ms").asLong();
        boolean early = false, late = false;
        for (JsonNode event : record.path("events")) {
            if (!refs.contains(event.path("id").asText())) continue;
            early |= event.path("start_ms").asLong() < duration / 3.0;
            late |= event.path("end_ms").asLong() > duration * 2.0 / 3.0;
        }
        require(duration > 0 && early && late,
                "whole-video focus needs observations spanning early and late video; otherwise use local");
    }
    private static void require(boolean valid, String message) {
        if (!valid) throw new IllegalArgumentException(message);
    }
}
