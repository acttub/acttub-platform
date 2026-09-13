package com.acttub.actingapi.feature.report.app;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** The server owns the note's substance; generation can only edit its small copy field. */
public final class PracticeNote {
    public static final String VERSION = "acttub.practice_note.v1";
    private static final String PROMPT = StructuredJson.instructions(
            StructuredJson.textResource("/coaching/note-prompt.txt")
                    + "\nsummary는 note_data에 이미 있는 문장을 원문 그대로 선택한다. 적합한 문장이 없으면 null이다. title은 focus.label의 원문 또는 연속된 발췌이며, focus가 없으면 이번 대화 기록이다.",
            "layer3_copy");

    private PracticeNote() { }

    public static boolean isNote(JsonNode value) {
        return value != null && VERSION.equals(value.path("schema_version").asText());
    }

    static ObjectNode assemble(JsonNode handoff, Function<String, String> generateCopy) {
        require(handoff != null && "acttub.coach_handoff.v1".equals(handoff.path("schema_version").asText()),
                "versioned handoff required");
        JsonNode state = handoff.path("coaching_state");
        require(state.path("revision").asLong(-1) == handoff.path("state_revision").asLong(-2), "handoff revision mismatch");
        JsonNode context = state.path("context");
        StructuredJson.validate("coach_context", context);
        ObjectNode note = StructuredJson.MAPPER.createObjectNode().put("schema_version", VERSION)
                .put("report_type", "practice_note").put("note_id", UUID.randomUUID().toString())
                .put("revision", 1).put("session_id", handoff.path("session_id").asText())
                .put("source_handoff_revision", handoff.path("state_revision").asLong())
                .put("lifecycle", "saved").put("end_reason", handoff.path("end_reason").asText());
        note.set("record_ref", handoff.path("record_ref").deepCopy());
        for (String field : List.of("direction", "focus", "reading", "open_points")) {
            note.set(field, context.path(field).deepCopy());
        }
        note.putNull("practice");
        JsonNode active = null;
        for (JsonNode proposal : state.path("proposals")) {
            StructuredJson.validate("proposal", proposal);
            if ("active".equals(proposal.path("lifecycle").asText())) {
                require(active == null, "multiple active proposals");
                active = proposal;
            }
        }
        if (active != null) {
            require(active.path("proposal_id").equals(state.path("active_proposal_id")), "active proposal mismatch");
            require(!note.path("direction").isNull() && !note.path("focus").isNull(), "practice lacks a direction or focus");
            ObjectNode practice = note.putObject("practice");
            for (String field : List.of("proposal_id", "selection", "selection_refs", "instruction", "comparison", "keep")) {
                practice.set(field, active.path(field).deepCopy());
            }
        }
        note.put("mode", active != null ? "action" : !note.path("focus").isNull() ? "observation" : "record_only");
        if ("record_only".equals(note.path("mode").asText())) { note.putNull("reading"); }
        note.set("attempts", state.path("attempts").deepCopy());
        note.set("source_catalog", handoff.path("source_catalog").deepCopy());
        ObjectNode copy = note.putObject("copy").put("title", defaultTitle(note)).putNull("summary");
        // Copy failure must not discard a valid conversation or prevent its atomic save.
        try {
            JsonNode generated = StructuredJson.parse(generateCopy.apply(note.toString()));
            StructuredJson.validate("layer3_copy", generated);
            String title = generated.path("title").asText();
            require(title.equals(defaultTitle(note)) || note.path("focus").path("label").asText().contains(title),
                    "title must reuse the recorded focus");
            copy.put("title", title);
            JsonNode summary = generated.path("summary");
            if (!summary.isNull()) {
                require(containsGroundedText(note, summary), "summary must reuse a recorded sentence and its sources");
                copy.set("summary", summary.deepCopy());
            }
        } catch (RuntimeException ignored) {
            copy.put("title", defaultTitle(note)).putNull("summary");
        }
        StructuredJson.validate("practice_note", note);
        validateRefs(note, sources(note));
        return note;
    }

    static String prompt() { return PROMPT; }

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
            if (anchor != null && "video_utterance".equals(anchor.path("kind").asText())) {
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

    private static String defaultTitle(JsonNode note) {
        String title = note.path("focus").path("label").asText("이번 대화 기록");
        return title.substring(0, title.offsetByCodePoints(0, Math.min(32, title.codePointCount(0, title.length()))));
    }

    private static void textOrNull(ObjectNode target, String key, JsonNode grounded) {
        if (grounded.isNull()) { target.putNull(key); }
        else { target.put(key, grounded.path("text").asText()); }
    }

    private static boolean containsGroundedText(JsonNode value, JsonNode candidate) {
        if (value.equals(candidate)) { return true; }
        if (value.isContainerNode()) {
            for (JsonNode child : value) { if (containsGroundedText(child, candidate)) { return true; } }
        }
        return false;
    }

    private static Map<String, JsonNode> sources(JsonNode note) {
        Map<String, JsonNode> sources = new LinkedHashMap<>();
        note.path("source_catalog").forEach(s -> sources.put(s.path("id").asText(), s));
        return sources;
    }

    private static void validateRefs(JsonNode node, Map<String, JsonNode> catalog) {
        if (node.isArray()) { node.forEach(n -> validateRefs(n, catalog)); return; }
        if (!node.isObject()) { return; }
        node.properties().forEach(entry -> {
            if (entry.getKey().endsWith("_refs")) {
                entry.getValue().forEach(ref -> require(catalog.containsKey(ref.asText()), "note source is missing"));
            } else if (!entry.getKey().equals("source_catalog")) { validateRefs(entry.getValue(), catalog); }
        });
    }

    private static void require(boolean condition, String message) {
        if (!condition) { throw new IllegalArgumentException(message); }
    }
}
