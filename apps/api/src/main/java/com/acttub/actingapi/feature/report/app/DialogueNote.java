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
import com.acttub.actingapi.platform.json.LenientJson;

/** Produces one proposed next take from a dialogue, without changing its intent or execution history. */
final class DialogueNote {
    static final String PROMPT = StructuredJson.instructions(
            StructuredJson.textResource("/coaching/note-prompt.txt"), "layer3_note");

    private DialogueNote() { }

    static PracticeNote.Generated assembleResult(JsonNode handoff, Function<String, String> generate,
            Consumer<RuntimeException> onFailure) {
        StructuredJson.validate("coach_handoff_v2", handoff);
        JsonNode context = handoff.path("context");
        Map<String, JsonNode> sources = new LinkedHashMap<>();
        handoff.path("source_catalog").forEach(s -> {
            require(sources.put(LenientJson.asText(s.path("id")), s) == null, "duplicate handoff source");
        });
        validateContextRefs(context, sources);
        JsonNode aim = currentAim(handoff, sources);
        boolean canPropose = !"system_failure".equals(LenientJson.asText(handoff.path("end_reason")))
                && !aim.isNull() && hasFocusEvidence(handoff, sources);
        ObjectNode input = StructuredJson.MAPPER.createObjectNode();
        input.set("coach_handoff", handoff.deepCopy());
        ObjectNode controls = input.putObject("controls").put("can_propose", canPropose).put("max_next_takes", 1);
        controls.set("aim", aim.deepCopy());
        if (canPropose) controls.put("next_take_basis", sceneFocus(context) ? "scene" : "delivery");
        else controls.putNull("next_take_basis");
        // Keep valid evidence on provider/validation failure; never manufacture an exercise to fill the UI.
        for (int attempt = 0; attempt < 2; attempt++) {
            try {
                ObjectNode note = base(handoff, sources);
                JsonNode generated = StructuredJson.parse(generate.apply(input.toString()));
                StructuredJson.validate("layer3_note", generated);
                ObjectNode summary = summary(withExperience(generated.path("summary"), handoff, sources), handoff, context, sources);
                JsonNode next = generated.path("next_take");
                if (!next.isNull()) validateNext(next, handoff, aim, sources, canPropose);
                ((ObjectNode) note.path("copy")).set("summary", summary == null
                        ? StructuredJson.MAPPER.nullNode() : summary);
                if (!next.isNull()) attachNext(note, next);
                StructuredJson.validate("practice_note", note);
                return new PracticeNote.Generated(note, false);
            } catch (RuntimeException failure) {
                onFailure.accept(failure);
                input.put("validation_error", failure instanceof IllegalArgumentException
                        ? failure.getMessage() : "generation unavailable; use only the supplied evidence");
            }
        }
        // Preserve current actor analysis on failure without manufacturing a new exercise.
        ObjectNode note = base(handoff, sources);
        ArrayNode experience = withExperience(StructuredJson.MAPPER.createArrayNode(), handoff, sources);
        if (experience.isEmpty() && !aim.isNull()) {
            String quote = LenientJson.asText(aim.path("text"));
            if (quote.codePointCount(0, quote.length()) <= 50) {
                for (JsonNode ref : aim.path("source_refs")) {
                    JsonNode source = sources.get(LenientJson.asText(ref));
                    if (LenientJson.asText(source.path("text")).contains(quote)) {
                        experience.addObject().put("source_ref", LenientJson.asText(ref)).put("quote", quote);
                        break;
                    }
                }
            }
        }
        if (!experience.isEmpty()) {
            ((ObjectNode) note.path("copy")).set("summary", summary(experience, handoff, context, sources));
            StructuredJson.validate("practice_note", note);
            return new PracticeNote.Generated(note, true);
        }
        for (JsonNode id : context.path("focus").path("evidence_refs")) {
            JsonNode source = sources.get(LenientJson.asText(id));
            String text = LenientJson.asText(source.path("text"));
            if ("video_utterance".equals(LenientJson.asText(source.path("kind")))) text = "장면 대사: “" + text + "”";
            if (eligibleEvidence(context, source) && text.codePointCount(0, text.length()) <= 120) {
                ObjectNode summary = ((ObjectNode) note.path("copy")).putObject("summary").put("text", text);
                summary.putArray("source_refs").add(LenientJson.asText(id));
                break;
            }
        }
        StructuredJson.validate("practice_note", note);
        return new PracticeNote.Generated(note, true);
    }

    private static ObjectNode base(JsonNode handoff, Map<String, JsonNode> sources) {
        ObjectNode note = StructuredJson.MAPPER.createObjectNode().put("schema_version", PracticeNote.VERSION)
                .put("report_type", "practice_note").put("note_id", UUID.randomUUID().toString())
                .put("revision", 1).put("session_id", LenientJson.asText(handoff.path("session_id")))
                .put("source_handoff_revision", LenientJson.asLong(handoff.path("state_revision")))
                .put("lifecycle", "saved").put("end_reason", LenientJson.asText(handoff.path("end_reason")));
        note.set("record_ref", handoff.path("record_ref").deepCopy());
        for (String field : List.of("direction", "scene_context", "focus", "open_points")) {
            note.set(field, handoff.path("context").path(field).deepCopy());
        }
        if (!currentActorValue(handoff, note.path("direction"), sources)) note.putNull("direction");
        for (String field : List.of("situation", "character_goal", "partner_action")) {
            if (!currentActorValue(handoff, note.path("scene_context").path(field), sources)) {
                ((ObjectNode) note.path("scene_context")).putNull(field);
            }
        }
        if (sceneFocus(handoff.path("context"))
                && handoff.path("context").path("scene_context").path("character_goal").isObject()
                && note.path("scene_context").path("character_goal").isNull()
                && currentAim(handoff, sources).isNull()) {
            // A retired goal must not reappear as the visible focus label either.
            note.putNull("focus");
        }
        note.putNull("reading").putNull("practice");
        note.put("mode", note.path("focus").isNull() ? "record_only" : "observation");
        note.putArray("attempts");
        note.set("source_catalog", handoff.path("source_catalog").deepCopy());
        note.putObject("copy").put("title", "연습 노트").putNull("summary");
        return note;
    }

    private static ObjectNode summary(JsonNode excerpts, JsonNode handoff, JsonNode context, Map<String, JsonNode> sources) {
        if (excerpts.isEmpty()) return null;
        List<String> lines = new ArrayList<>();
        Set<String> kinds = new LinkedHashSet<>();
        ArrayNode refs = StructuredJson.MAPPER.createArrayNode();
        for (JsonNode excerpt : excerpts) {
            String id = LenientJson.asText(excerpt.path("source_ref"));
            JsonNode source = sources.get(id);
            String quote = LenientJson.asText(excerpt.path("quote")).strip();
            require(source != null && !quote.isBlank() && LenientJson.asText(source.path("text")).contains(quote),
                    "summary quote must occur in its source");
            String kind = LenientJson.asText(source.path("kind"));
            if (kind.equals("video_observation") || kind.equals("video_utterance")) {
                require(eligibleEvidence(context, source), "scene dialogue cannot establish observed delivery");
                require(contains(context.path("focus").path("evidence_refs"), id), "summary must keep the current focus");
                lines.add(kind.equals("video_utterance") ? "장면 대사: “" + quote + "”" : quote);
                kind = "evidence";
            } else {
                require(Set.of("actor_message", "actor_input").contains(kind), "summary cannot turn coach interpretation into fact");
                require(isCurrentActorQuote(handoff, context, id, quote), "summary must use the current actor context or latest actor experience");
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

    private static boolean isCurrentActorQuote(JsonNode handoff, JsonNode context, String id, String quote) {
        // An experience does not need to be promoted to an acting goal to survive in the note.
        // Use the latest substantive actor turn, so later corrections supersede older experiences.
        JsonNode conversation = handoff.path("conversation");
        for (int i = conversation.size() - 1; i >= 0; i--) {
            JsonNode message = conversation.get(i);
            if (!"actor".equals(LenientJson.asText(message.path("role")))) continue;
            String text = LenientJson.asText(message.path("text")).strip();
            if (text.matches("(?:그만|여기까지|끝|종료|마칠게|마칠게요|그만할래|그만할게|그만할게요)[.!?\\s]*")
                    || text.matches("(?:(?:여기까지|지금까지|오늘은|오늘 대화|이번 대화)\\s*)?정리(?:해줘|해 줘|해주세요|해 주세요)[.!?\\s]*")
                    || text.matches("[\\s.!?]*(네+|응|ㅇㅇ|ㅇㅋ|알겠어|알겠어요)[\\s.!?]*")) continue;
            if (LenientJson.asText(message.path("id")).equals(id)) {
                return text.contains(quote)
                        && !quote.matches("[\\s.!?？]*")
                        && !quote.matches("[\\s.!?？]*(모르겠(?:어|어요|다)|몰라(?:요)?|ㅁㄹ|아니(?:지|야|요)?|뭐라는\\s*거야)[\\s.!?？]*");
            }
            // A later question must not erase an already-grounded current direction.
            // Explicit corrections must not revive an older quote, even if context is stale.
            if (text.matches("(?s)^(?:아니|정정|취소|잘못 말).*")) return false;
            break;
        }
        List<JsonNode> values = new ArrayList<>();
        values.add(context.path("direction"));
        context.path("scene_context").forEach(values::add);
        return values.stream().anyMatch(value -> contains(value.path("source_refs"), id)
                && LenientJson.asText(value.path("text")).contains(quote));
    }

    private static ArrayNode withExperience(JsonNode excerpts, JsonNode handoff, Map<String, JsonNode> sources) {
        ArrayNode result = excerpts.deepCopy();
        for (JsonNode message : handoff.path("conversation")) {
            String id = LenientJson.asText(message.path("id"));
            String text = LenientJson.asText(message.path("text"));
            JsonNode source = sources.get(id);
            if (!"actor".equals(LenientJson.asText(message.path("role"))) || !ActorExperience.onlyExperience(text)
                    || text.codePointCount(0, text.length()) > 50 || source == null
                    || !"actor_message".equals(LenientJson.asText(source.path("kind")))
                    || !LenientJson.asText(source.path("text")).equals(text)
                    || !isCurrentActorQuote(handoff, handoff.path("context"), id, text)) continue;
            // Preserve the exact latest short experience even when the model omits an actor excerpt.
            ArrayNode kept = StructuredJson.MAPPER.createArrayNode();
            kept.addObject().put("source_ref", id).put("quote", text);
            for (JsonNode excerpt : result) {
                JsonNode cited = sources.get(LenientJson.asText(excerpt.path("source_ref")));
                if (cited != null && eligibleEvidence(handoff.path("context"), cited)) kept.add(excerpt);
            }
            // Do not silently fix invalid model summaries; validate them before substituting the actor quote.
            summary(result, handoff, handoff.path("context"), sources);
            return kept;
        }
        return result;
    }

    private static void validateNext(JsonNode next, JsonNode handoff, JsonNode aim,
            Map<String, JsonNode> sources, boolean canPropose) {
        JsonNode context = handoff.path("context");
        require(canPropose, "next take requires actor direction or a current scene goal and matching video evidence");
        JsonNode refs = next.path("basis_refs");
        for (JsonNode ref : refs) require(sources.containsKey(LenientJson.asText(ref)), "next take cites an unavailable source");
        boolean actor = false, evidence = false;
        for (JsonNode ref : refs) {
            String id = LenientJson.asText(ref);
            actor |= contains(aim.path("source_refs"), id);
            evidence |= contains(context.path("focus").path("evidence_refs"), id)
                    && eligibleEvidence(context, sources.get(id)) && sameRecord(handoff, sources.get(id));
        }
        require(actor && evidence, "next take must connect current actor aim to matching focus evidence");
        validateScope(next, handoff, sources);
        for (String field : List.of("instruction", "comparison")) {
            String text = LenientJson.asText(next.path(field));
            require(!text.isBlank() && !text.contains("\n") && !text.contains("?") && !text.contains("**")
                    && !text.contains("```"), "next take must be one plain instruction and comparison");
            require(!text.matches("(?s).*(망설임|읽힘|전달의 결|에너지를|반드시|무조건|완벽|향상됐|개선됐|성공했).*"),
                    "next take must be concrete and must not guarantee improvement");
        }
    }

    private static void attachNext(ObjectNode note, JsonNode next) {
        String id = "note:" + LenientJson.asText(note.path("note_id")) + ":proposal";
        ObjectNode source = ((ArrayNode) note.path("source_catalog")).addObject().put("id", id)
                .put("kind", "coach_message").put("text", LenientJson.asText(next.path("instruction")) + "\n" + LenientJson.asText(next.path("comparison")));
        source.putNull("record_id").putNull("record_version").putNull("start_ms").putNull("end_ms");
        ObjectNode practice = note.putObject("practice").put("proposal_id", UUID.randomUUID().toString())
                .put("selection", "proposed").putNull("keep");
        practice.putArray("selection_refs");
        for (String key : List.of("instruction", "comparison")) {
            ObjectNode value = practice.putObject(key).put("text", LenientJson.asText(next.path(key)));
            ArrayNode refs = next.path("basis_refs").deepCopy();
            refs.add(id); value.set("source_refs", refs);
        }
        note.put("mode", "action");
    }

    private static boolean actorDirection(JsonNode direction, Map<String, JsonNode> sources) {
        if (direction.isNull() || "coach_proposed".equals(LenientJson.asText(direction.path("origin")))) return false;
        for (JsonNode id : direction.path("source_refs")) {
            JsonNode source = sources.get(LenientJson.asText(id));
            if (source != null && Set.of("actor_input", "actor_message").contains(LenientJson.asText(source.path("kind")))
                    && LenientJson.asText(source.path("text")).contains(LenientJson.asText(direction.path("text")))
                    && !ActorExperience.onlyExperience(LenientJson.asText(source.path("text")))) return true;
        }
        return false;
    }

    private static JsonNode currentAim(JsonNode handoff, Map<String, JsonNode> sources) {
        JsonNode context = handoff.path("context");
        List<JsonNode> candidates = new ArrayList<>();
        candidates.add(context.path("direction"));
        if (sceneFocus(context)) candidates.add(context.path("scene_context").path("character_goal"));
        for (JsonNode value : candidates) {
            if (currentActorValue(handoff, value, sources)) return value;
        }
        return StructuredJson.MAPPER.nullNode();
    }

    private static boolean currentActorValue(JsonNode handoff, JsonNode value, Map<String, JsonNode> sources) {
        if (!actorDirection(value, sources)) return false;
        for (JsonNode ref : value.path("source_refs")) {
            if (isCurrentActorQuote(handoff, handoff.path("context"), LenientJson.asText(ref), LenientJson.asText(value.path("text")))) return true;
        }
        return false;
    }

    private static boolean sceneFocus(JsonNode context) {
        return "scene".equals(LenientJson.asText(context.path("focus").path("basis")));
    }

    private static boolean eligibleEvidence(JsonNode context, JsonNode source) {
        String kind = LenientJson.asText(source.path("kind"));
        return "video_observation".equals(kind) || sceneFocus(context) && "video_utterance".equals(kind);
    }

    private static boolean sameRecord(JsonNode handoff, JsonNode source) {
        JsonNode record = handoff.path("record_ref");
        return record.isObject() && record.path("record_id").equals(source.path("record_id"))
                && record.path("version").equals(source.path("record_version"));
    }

    private static boolean hasFocusEvidence(JsonNode handoff, Map<String, JsonNode> sources) {
        JsonNode context = handoff.path("context");
        for (JsonNode id : context.path("focus").path("evidence_refs")) {
            JsonNode source = sources.get(LenientJson.asText(id));
            if (eligibleEvidence(context, source) && sameRecord(handoff, source)) return true;
        }
        return false;
    }

    /** A representative line cannot silently shrink an already-established whole-scene topic. */
    private static void validateScope(JsonNode next, JsonNode handoff, Map<String, JsonNode> sources) {
        JsonNode context = handoff.path("context");
        JsonNode focus = context.path("focus");
        if (!"whole_video".equals(LenientJson.asText(focus.path("scope")))) return;
        long start = Long.MAX_VALUE, end = 0;
        for (JsonNode ref : focus.path("evidence_refs")) {
            JsonNode source = sources.get(LenientJson.asText(ref));
            if (!eligibleEvidence(context, source) || !sameRecord(handoff, source)) continue;
            start = Math.min(start, LenientJson.asLong(source.path("start_ms")));
            end = Math.max(end, LenientJson.asLong(source.path("end_ms")));
        }
        boolean early = false, late = false;
        for (JsonNode ref : next.path("basis_refs")) {
            JsonNode source = sources.get(LenientJson.asText(ref));
            if (!contains(focus.path("evidence_refs"), LenientJson.asText(ref))
                    || !eligibleEvidence(context, source) || !sameRecord(handoff, source)) continue;
            early |= LenientJson.asLong(source.path("start_ms")) < start + (end - start) / 3.0;
            late |= LenientJson.asLong(source.path("end_ms")) > start + (end - start) * 2.0 / 3.0;
        }
        require(end > start && early && late, "whole-scene next take must retain evidence from early and late focus ranges");
    }

    private static void validateContextRefs(JsonNode node, Map<String, JsonNode> sources) {
        if (node.isArray()) { node.forEach(n -> validateContextRefs(n, sources)); return; }
        if (!node.isObject()) return;
        node.properties().forEach(entry -> {
            if (entry.getKey().endsWith("_refs")) {
                entry.getValue().forEach(id -> require(sources.containsKey(LenientJson.asText(id)), "handoff context source is missing"));
            } else if (entry.getKey().equals("utterance_ref") && !entry.getValue().isNull()) {
                require(sources.containsKey(LenientJson.asText(entry.getValue())), "handoff utterance is missing");
            } else validateContextRefs(entry.getValue(), sources);
        });
    }

    private static boolean contains(JsonNode refs, String id) {
        for (JsonNode ref : refs) if (LenientJson.asText(ref).equals(id)) return true;
        return false;
    }

    private static void require(boolean condition, String message) {
        if (!condition) throw new IllegalArgumentException(message);
    }
}
