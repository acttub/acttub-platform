package com.acttub.actingapi.feature.report.app;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import java.util.function.Function;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Produces one proposed next take from a dialogue, without changing its intent or execution history. */
final class DialogueNote {
    static final String PROMPT = StructuredJson.instructions(
            StructuredJson.textResource("/coaching/note-prompt.txt"), "layer3_note");

    private DialogueNote() { }

    static ObjectNode assemble(JsonNode handoff, Function<String, String> generate,
            Consumer<RuntimeException> onFailure) {
        StructuredJson.validate("coach_handoff_v2", handoff);
        JsonNode context = handoff.path("context");
        Map<String, JsonNode> sources = new LinkedHashMap<>();
        handoff.path("source_catalog").forEach(s -> {
            require(sources.put(s.path("id").asText(), s) == null, "duplicate handoff source");
        });
        validateContextRefs(context, sources);
        boolean canPropose = !"system_failure".equals(handoff.path("end_reason").asText())
                && actorDirection(context.path("direction"), sources)
                && hasObservation(context.path("focus").path("evidence_refs"), sources);
        ObjectNode input = StructuredJson.MAPPER.createObjectNode();
        input.set("coach_handoff", handoff.deepCopy());
        input.putObject("controls").put("can_propose", canPropose).put("max_next_takes", 1);
        // Keep valid evidence on provider/validation failure; never manufacture an exercise to fill the UI.
        for (int attempt = 0; attempt < 2; attempt++) {
            try {
                ObjectNode note = base(handoff);
                JsonNode generated = StructuredJson.parse(generate.apply(input.toString()));
                StructuredJson.validate("layer3_note", generated);
                ObjectNode summary = summary(generated.path("summary"), context, sources);
                JsonNode next = generated.path("next_take");
                if (!next.isNull()) validateNext(next, context, sources, canPropose);
                ((ObjectNode) note.path("copy")).set("summary", summary == null
                        ? StructuredJson.MAPPER.nullNode() : summary);
                if (!next.isNull()) attachNext(note, next);
                StructuredJson.validate("practice_note", note);
                return note;
            } catch (RuntimeException failure) {
                onFailure.accept(failure);
                input.put("validation_error", failure instanceof IllegalArgumentException
                        ? failure.getMessage() : "generation unavailable; use only the supplied evidence");
            }
        }
        // A deterministic, cited fallback records the discussed observation only.
        ObjectNode note = base(handoff);
        for (JsonNode id : context.path("focus").path("evidence_refs")) {
            JsonNode source = sources.get(id.asText());
            String text = source.path("text").asText();
            if ("video_observation".equals(source.path("kind").asText()) && text.codePointCount(0, text.length()) <= 120) {
                ObjectNode summary = ((ObjectNode) note.path("copy")).putObject("summary").put("text", text);
                summary.putArray("source_refs").add(id.asText());
                break;
            }
        }
        StructuredJson.validate("practice_note", note);
        return note;
    }

    private static ObjectNode base(JsonNode handoff) {
        ObjectNode note = StructuredJson.MAPPER.createObjectNode().put("schema_version", PracticeNote.VERSION)
                .put("report_type", "practice_note").put("note_id", UUID.randomUUID().toString())
                .put("revision", 1).put("session_id", handoff.path("session_id").asText())
                .put("source_handoff_revision", handoff.path("state_revision").asLong())
                .put("lifecycle", "saved").put("end_reason", handoff.path("end_reason").asText());
        note.set("record_ref", handoff.path("record_ref").deepCopy());
        for (String field : List.of("direction", "scene_context", "focus", "open_points")) {
            note.set(field, handoff.path("context").path(field).deepCopy());
        }
        note.putNull("reading").putNull("practice");
        note.put("mode", note.path("focus").isNull() ? "record_only" : "observation");
        note.putArray("attempts");
        note.set("source_catalog", handoff.path("source_catalog").deepCopy());
        note.putObject("copy").put("title", "연습 노트").putNull("summary");
        return note;
    }

    private static ObjectNode summary(JsonNode excerpts, JsonNode context, Map<String, JsonNode> sources) {
        if (excerpts.isEmpty()) return null;
        List<String> lines = new ArrayList<>();
        Set<String> kinds = new LinkedHashSet<>();
        ArrayNode refs = StructuredJson.MAPPER.createArrayNode();
        for (JsonNode excerpt : excerpts) {
            String id = excerpt.path("source_ref").asText();
            JsonNode source = sources.get(id);
            String quote = excerpt.path("quote").asText().strip();
            require(source != null && !quote.isBlank() && source.path("text").asText().contains(quote),
                    "summary quote must occur in its source");
            String kind = source.path("kind").asText();
            if (kind.equals("video_observation")) {
                require(contains(context.path("focus").path("evidence_refs"), id), "summary must keep the current focus");
                lines.add(quote);
            } else {
                require(Set.of("actor_message", "actor_input").contains(kind), "summary cannot turn coach interpretation into fact");
                require(isCurrentActorQuote(context, id, quote), "summary must use the current actor context");
                kind = "actor";
                lines.add("“" + quote + "”라고 했어요.");
            }
            require(kinds.add(kind), "summarize actor and observation once each");
            refs.add(id);
        }
        ObjectNode summary = StructuredJson.MAPPER.createObjectNode().put("text", String.join(" ", lines));
        summary.set("source_refs", refs);
        return summary;
    }

    private static boolean isCurrentActorQuote(JsonNode context, String id, String quote) {
        List<JsonNode> values = new ArrayList<>();
        values.add(context.path("direction"));
        context.path("scene_context").forEach(values::add);
        return values.stream().anyMatch(value -> contains(value.path("source_refs"), id)
                && value.path("text").asText().contains(quote));
    }

    private static void validateNext(JsonNode next, JsonNode context, Map<String, JsonNode> sources, boolean canPropose) {
        require(canPropose, "next take requires actor direction and a discussed observation");
        JsonNode refs = next.path("basis_refs");
        for (JsonNode ref : refs) require(sources.containsKey(ref.asText()), "next take cites an unavailable source");
        boolean actor = false, observation = false;
        for (JsonNode ref : refs) {
            String id = ref.asText();
            actor |= contains(context.path("direction").path("source_refs"), id);
            observation |= contains(context.path("focus").path("evidence_refs"), id)
                    && "video_observation".equals(sources.get(id).path("kind").asText());
        }
        require(actor && observation, "next take must connect current actor direction to the observation");
        for (String field : List.of("instruction", "comparison")) {
            String text = next.path(field).asText();
            require(!text.isBlank() && !text.contains("\n") && !text.contains("?") && !text.contains("**")
                    && !text.contains("```"), "next take must be one plain instruction and comparison");
            require(!text.matches("(?s).*(망설임|읽힘|전달의 결|에너지를|반드시|무조건|완벽|향상됐|개선됐|성공했).*"),
                    "next take must be concrete and must not guarantee improvement");
        }
    }

    private static void attachNext(ObjectNode note, JsonNode next) {
        String id = "note:" + note.path("note_id").asText() + ":proposal";
        ObjectNode source = ((ArrayNode) note.path("source_catalog")).addObject().put("id", id)
                .put("kind", "coach_message").put("text", next.path("instruction").asText() + "\n" + next.path("comparison").asText());
        source.putNull("record_id").putNull("record_version").putNull("start_ms").putNull("end_ms");
        ObjectNode practice = note.putObject("practice").put("proposal_id", UUID.randomUUID().toString())
                .put("selection", "proposed").putNull("keep");
        practice.putArray("selection_refs");
        for (String key : List.of("instruction", "comparison")) {
            ObjectNode value = practice.putObject(key).put("text", next.path(key).asText());
            ArrayNode refs = next.path("basis_refs").deepCopy();
            refs.add(id); value.set("source_refs", refs);
        }
        note.put("mode", "action");
    }

    private static boolean actorDirection(JsonNode direction, Map<String, JsonNode> sources) {
        if (direction.isNull() || "coach_proposed".equals(direction.path("origin").asText())) return false;
        for (JsonNode id : direction.path("source_refs")) {
            JsonNode source = sources.get(id.asText());
            if (source != null && Set.of("actor_input", "actor_message").contains(source.path("kind").asText())
                    && source.path("text").asText().contains(direction.path("text").asText())) return true;
        }
        return false;
    }

    private static boolean hasObservation(JsonNode refs, Map<String, JsonNode> sources) {
        for (JsonNode id : refs) if (sources.containsKey(id.asText())
                && "video_observation".equals(sources.get(id.asText()).path("kind").asText())) return true;
        return false;
    }

    private static void validateContextRefs(JsonNode node, Map<String, JsonNode> sources) {
        if (node.isArray()) { node.forEach(n -> validateContextRefs(n, sources)); return; }
        if (!node.isObject()) return;
        node.properties().forEach(entry -> {
            if (entry.getKey().endsWith("_refs")) {
                entry.getValue().forEach(id -> require(sources.containsKey(id.asText()), "handoff context source is missing"));
            } else if (entry.getKey().equals("utterance_ref") && !entry.getValue().isNull()) {
                require(sources.containsKey(entry.getValue().asText()), "handoff utterance is missing");
            } else validateContextRefs(entry.getValue(), sources);
        });
    }

    private static boolean contains(JsonNode refs, String id) {
        for (JsonNode ref : refs) if (ref.asText().equals(id)) return true;
        return false;
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalArgumentException(message);
    }
}
