package com.acttub.actingapi.feature.report.app;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.integration.llm.StructuredJson;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import com.acttub.actingapi.platform.json.LenientJson;

/** 저장된 노트 JSON 을 알아보고 공개 응답으로 투영한다. 노트 조립은 {@link DialogueNote} 가 한다. */
public final class PracticeNote {
    public static final String VERSION = "acttub.practice_note.v1";

    private PracticeNote() { }

    /** 모델 응답 대신 보존된 근거로 만든 노트인지 별도로 전달한다. 저장된 노트 JSON 계약은 바꾸지 않는다. */
    public record Generated(ObjectNode note, boolean fallback) { }

    public static boolean isNote(JsonNode value) {
        return value != null && VERSION.equals(LenientJson.asText(value.path("schema_version")));
    }

    /** Explicit projection: internal actor messages, state and source catalog never leak into public JSON. */
    public static JsonNode publicView(JsonNode stored) {
        if (!isNote(stored)) { return stored; }
        ObjectNode view = StructuredJson.MAPPER.createObjectNode().put("schema_version", "acttub.public_practice_note.v1")
                .put("report_type", "practice_note").put("title", LenientJson.asText(stored.path("copy").path("title")));
        for (String key : List.of("note_id", "revision", "mode", "end_reason", "record_ref", "lifecycle")) {
            view.set(key, stored.path(key).deepCopy());
        }
        textOrNull(view, "summary", stored.path("copy").path("summary"));
        textOrNull(view, "reading", stored.path("reading"));
        if (stored.path("direction").isNull()) { view.putNull("direction"); }
        else { view.putObject("direction").put("text", LenientJson.asText(stored.path("direction").path("text")))
                .put("origin", LenientJson.asText(stored.path("direction").path("origin"))); }
        Map<String, JsonNode> catalog = sources(stored);
        JsonNode focus = stored.path("focus");
        if (focus.isNull()) { view.putNull("focus"); }
        else {
            ObjectNode output = view.putObject("focus").put("label", LenientJson.asText(focus.path("label")));
            JsonNode anchor = catalog.get(LenientJson.asText(focus.path("utterance_ref")));
            if (anchor == null && !focus.path("evidence_refs").isEmpty()) {
                anchor = catalog.get(LenientJson.asText(focus.path("evidence_refs").get(0)));
            }
            output.set("start_ms", anchor == null ? StructuredJson.MAPPER.nullNode() : anchor.path("start_ms"));
            output.set("end_ms", anchor == null ? StructuredJson.MAPPER.nullNode() : anchor.path("end_ms"));
            boolean wholeScene = "whole_video".equals(LenientJson.asText(focus.path("scope")));
            if (wholeScene) {
                long start = Long.MAX_VALUE, end = 0;
                for (JsonNode ref : focus.path("evidence_refs")) {
                    JsonNode source = catalog.get(LenientJson.asText(ref));
                    if (source == null || !LenientJson.asText(source.path("kind")).startsWith("video_")
                            || !source.path("start_ms").isNumber() || !source.path("end_ms").isNumber()) continue;
                    start = Math.min(start, LenientJson.asLong(source.path("start_ms")));
                    end = Math.max(end, LenientJson.asLong(source.path("end_ms")));
                }
                if (end > start) output.put("start_ms", start).put("end_ms", end);
            }
            if (!wholeScene && anchor != null && "video_utterance".equals(LenientJson.asText(anchor.path("kind")))) {
                output.put("quote", LenientJson.asText(anchor.path("text")));
            } else { output.putNull("quote"); }
        }
        JsonNode practice = stored.path("practice");
        if (practice.isNull()) { view.putNull("practice"); }
        else {
            ObjectNode output = view.putObject("practice").put("proposal_id", LenientJson.asText(practice.path("proposal_id")))
                    .put("selection", LenientJson.asText(practice.path("selection")));
            for (String key : List.of("instruction", "comparison", "keep")) { textOrNull(output, key, practice.path(key)); }
        }
        ArrayNode attempts = view.putArray("attempts");
        for (JsonNode attempt : stored.path("attempts")) {
            ObjectNode output = attempts.addObject().put("attempt_id", LenientJson.asText(attempt.path("attempt_id")))
                    .put("proposal_id", LenientJson.asText(attempt.path("proposal_id"))).put("execution", LenientJson.asText(attempt.path("execution")));
            textOrNull(output, "instruction", attempt.path("instruction"));
            if (attempt.path("result").isNull()) { output.putNull("result"); }
            else { output.putObject("result").put("direction", LenientJson.asText(attempt.path("result").path("direction")))
                    .put("statement", LenientJson.asText(attempt.path("result").path("statement").path("text")))
                    .put("basis", "actor_report"); }
        }
        ArrayNode open = view.putArray("open_points");
        stored.path("open_points").forEach(item -> open.add(LenientJson.asText(item.path("text"))));
        ArrayNode evidence = view.putArray("evidence");
        catalog.values().stream().filter(s -> LenientJson.asText(s.path("kind")).startsWith("video_")
                || "record_limitation".equals(LenientJson.asText(s.path("kind")))).forEach(s -> {
                    ObjectNode item = evidence.addObject();
                    for (String key : List.of("id", "kind", "text", "start_ms", "end_ms")) { item.set(key, s.path(key)); }
                });
        return view;
    }

    private static void textOrNull(ObjectNode target, String key, JsonNode grounded) {
        if (grounded.isNull()) { target.putNull(key); }
        else { target.put(key, LenientJson.asText(grounded.path("text"))); }
    }

    private static Map<String, JsonNode> sources(JsonNode note) {
        Map<String, JsonNode> sources = new LinkedHashMap<>();
        note.path("source_catalog").forEach(s -> sources.put(LenientJson.asText(s.path("id")), s));
        return sources;
    }
}
