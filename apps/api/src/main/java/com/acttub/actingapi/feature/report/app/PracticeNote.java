package com.acttub.actingapi.feature.report.app;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** 저장된 노트 JSON 을 알아보고 공개 응답으로 투영한다. 노트 조립은 {@link DialogueNote} 가 한다. */
public final class PracticeNote {
    public static final String VERSION = "acttub.practice_note.v1";

    private PracticeNote() { }

    /** 모델 응답 대신 보존된 근거로 만든 노트인지 별도로 전달한다. 저장된 노트 JSON 계약은 바꾸지 않는다. */
    public record Generated(ObjectNode note, boolean fallback) { }

    public static boolean isNote(JsonNode value) {
        return value != null && VERSION.equals(value.path("schema_version").asText());
    }

    /** Explicit projection: internal actor messages, state and source catalog never leak into public JSON. */
    public static JsonNode publicView(JsonNode stored) {
        if (!isNote(stored)) { return stored; }
        ObjectNode view = StructuredJson.MAPPER.createObjectNode().put("schema_version", "acttub.public_practice_note.v1")
                .put("report_type", "practice_note").put("title", stored.path("copy").path("title").asText());
        for (String key : List.of("note_id", "revision", "mode", "end_reason", "record_ref", "lifecycle")) {
            view.set(key, stored.path(key).deepCopy());
        }
        textOrNull(view, "summary", stored.path("copy").path("summary"));
        textOrNull(view, "reading", stored.path("reading"));
        if (stored.path("direction").isNull()) { view.putNull("direction"); }
        else { view.putObject("direction").put("text", stored.path("direction").path("text").asText())
                .put("origin", stored.path("direction").path("origin").asText()); }
        Map<String, JsonNode> catalog = sources(stored);
        JsonNode focus = stored.path("focus");
        if (focus.isNull()) { view.putNull("focus"); }
        else {
            ObjectNode output = view.putObject("focus").put("label", focus.path("label").asText());
            JsonNode anchor = catalog.get(focus.path("utterance_ref").asText());
            if (anchor == null && !focus.path("evidence_refs").isEmpty()) {
                anchor = catalog.get(focus.path("evidence_refs").get(0).asText());
            }
            output.set("start_ms", anchor == null ? StructuredJson.MAPPER.nullNode() : anchor.path("start_ms"));
            output.set("end_ms", anchor == null ? StructuredJson.MAPPER.nullNode() : anchor.path("end_ms"));
            boolean wholeScene = "whole_video".equals(focus.path("scope").asText());
            if (wholeScene) {
                long start = Long.MAX_VALUE, end = 0;
                for (JsonNode ref : focus.path("evidence_refs")) {
                    JsonNode source = catalog.get(ref.asText());
                    if (source == null || !source.path("kind").asText().startsWith("video_")
                            || !source.path("start_ms").isNumber() || !source.path("end_ms").isNumber()) continue;
                    start = Math.min(start, source.path("start_ms").asLong());
                    end = Math.max(end, source.path("end_ms").asLong());
                }
                if (end > start) output.put("start_ms", start).put("end_ms", end);
            }
            if (!wholeScene && anchor != null && "video_utterance".equals(anchor.path("kind").asText())) {
                output.put("quote", anchor.path("text").asText());
            } else { output.putNull("quote"); }
        }
        JsonNode practice = stored.path("practice");
        if (practice.isNull()) { view.putNull("practice"); }
        else {
            ObjectNode output = view.putObject("practice").put("proposal_id", practice.path("proposal_id").asText())
                    .put("selection", practice.path("selection").asText());
            for (String key : List.of("instruction", "comparison", "keep")) { textOrNull(output, key, practice.path(key)); }
        }
        ArrayNode attempts = view.putArray("attempts");
        for (JsonNode attempt : stored.path("attempts")) {
            ObjectNode output = attempts.addObject().put("attempt_id", attempt.path("attempt_id").asText())
                    .put("proposal_id", attempt.path("proposal_id").asText()).put("execution", attempt.path("execution").asText());
            textOrNull(output, "instruction", attempt.path("instruction"));
            if (attempt.path("result").isNull()) { output.putNull("result"); }
            else { output.putObject("result").put("direction", attempt.path("result").path("direction").asText())
                    .put("statement", attempt.path("result").path("statement").path("text").asText())
                    .put("basis", "actor_report"); }
        }
        ArrayNode open = view.putArray("open_points");
        stored.path("open_points").forEach(item -> open.add(item.path("text").asText()));
        ArrayNode evidence = view.putArray("evidence");
        catalog.values().stream().filter(s -> s.path("kind").asText().startsWith("video_")
                || "record_limitation".equals(s.path("kind").asText())).forEach(s -> {
                    ObjectNode item = evidence.addObject();
                    for (String key : List.of("id", "kind", "text", "start_ms", "end_ms")) { item.set(key, s.path(key)); }
                });
        return view;
    }

    private static void textOrNull(ObjectNode target, String key, JsonNode grounded) {
        if (grounded.isNull()) { target.putNull(key); }
        else { target.put(key, grounded.path("text").asText()); }
    }

    private static Map<String, JsonNode> sources(JsonNode note) {
        Map<String, JsonNode> sources = new LinkedHashMap<>();
        note.path("source_catalog").forEach(s -> sources.put(s.path("id").asText(), s));
        return sources;
    }
}
