package com.acttub.actingapi.feature.coach.app;

import java.util.HashSet;
import java.util.Set;
import com.fasterxml.jackson.databind.JsonNode;
import com.acttub.actingapi.platform.json.LenientJson;

/** Temporal guard only: semantic relevance still requires model evaluation. Legacy focus stays local. */
final class FocusCoverage {
    private FocusCoverage() { }
    static void validate(JsonNode focus, JsonNode record, JsonNode view) {
        if (!"whole_video".equals(LenientJson.asText(focus.path("scope")))) return;
        boolean singleSpokenScene = "scene".equals(LenientJson.asText(focus.path("basis")))
                && record.path("speech").path("utterances").size() == 1;
        require(!"isolated".equals(LenientJson.asText(focus.path("pattern"))) || singleSpokenScene,
                "whole-video focus cannot be isolated unless scene analysis covers the only utterance. 특정 발화의 표현 평가는 focus.scope=local, pattern=isolated로 바꾼다.");
        require("ready".equals(LenientJson.asText(record.path("processing").path("status")))
                && record.path("processing").path("missing_ranges").isEmpty(),
                "analysis has missing ranges; use local focus");
        Set<String> delivered = new HashSet<>();
        view.path("source_catalog").forEach(source -> delivered.add(LenientJson.asText(source.path("id"))));
        for (String group : new String[]{"events", "limitations"}) {
            for (JsonNode fact : record.path(group)) require(delivered.contains(LenientJson.asText(fact.path("id"))),
                    "whole-video focus requires all observations and limitations; lookup more or use local");
        }
        Set<String> refs = new HashSet<>();
        focus.path("evidence_refs").forEach(ref -> refs.add(LenientJson.asText(ref)));
        long duration = LenientJson.asLong(record.path("media").path("duration_ms"));
        boolean scene = "scene".equals(LenientJson.asText(focus.path("basis")));
        long start = 0, end = duration;
        JsonNode utterances = record.path("speech").path("utterances");
        if (scene && !utterances.isEmpty()) {
            start = Long.MAX_VALUE; end = 0;
            for (JsonNode utterance : utterances) {
                require(delivered.contains(LenientJson.asText(utterance.path("id"))),
                        "whole-scene analysis requires all utterances; lookup more or use local");
                start = Math.min(start, LenientJson.asLong(utterance.path("start_ms")));
                end = Math.max(end, LenientJson.asLong(utterance.path("end_ms")));
            }
        }
        double earlyEnd = start + (end - start) / 3.0;
        double lateStart = start + (end - start) * 2.0 / 3.0;
        boolean early = false, late = false;
        for (JsonNode event : record.path("events")) {
            if (!refs.contains(LenientJson.asText(event.path("id")))) continue;
            early |= LenientJson.asLong(event.path("start_ms")) < earlyEnd;
            late |= LenientJson.asLong(event.path("end_ms")) > lateStart;
        }
        if (scene) for (JsonNode utterance : utterances) {
            if (!refs.contains(LenientJson.asText(utterance.path("id")))) continue;
            early |= LenientJson.asLong(utterance.path("start_ms")) < earlyEnd;
            late |= LenientJson.asLong(utterance.path("end_ms")) > lateStart;
        }
        require(duration > 0 && end > start && early && late,
                "whole-video focus needs evidence spanning early and late "
                + (scene ? "scene dialogue" : "video; scene analysis may use basis=scene with transcript evidence")
                + "; otherwise use local or keep the existing focus");
    }
    private static void require(boolean valid, String message) {
        if (!valid) throw new IllegalArgumentException(message);
    }
}
