package com.acttub.actingapi.feature.coach.app;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.coach.domain.ClosingIntent;
import com.acttub.actingapi.integration.llm.StructuredJson;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;
import com.acttub.actingapi.platform.json.LenientJson;

/** Validates a proposed transition before either the message or its state can be saved. */
final class CoachingStateReducer {
    // Quoted dialogue is part of a coach sentence. Word-internal apostrophes are not quote boundaries.
    private static final Pattern QUOTED_SENTENCES = Pattern.compile(
            "“[^”]*”|‘[^’]*’|\"[^\"]*\"|(?<![A-Za-z0-9])'[^']*'(?![A-Za-z0-9])");
    private CoachingStateReducer() { }

    static ObjectNode empty() {
        ObjectNode state = StructuredJson.MAPPER.createObjectNode().put("revision", 0);
        ObjectNode context = state.putObject("context");
        context.putNull("direction");
        context.putObject("scene_context").putNull("situation").putNull("character_goal")
                .putNull("partner_action");
        context.putNull("focus").putNull("reading").putArray("open_points");
        state.putNull("active_proposal_id");
        state.putArray("proposals");
        state.putArray("attempts");
        state.put("response_style", "normal");
        state.putArray("source_catalog");
        return state;
    }

    static ObjectNode apply(JsonNode previous, JsonNode response, JsonNode sources,
            String actorId, String coachId, String proposalId, String attemptId,
            int maxChars, int maxSentences, boolean finishRequired) {
        StructuredJson.validate("layer2_respond", response);
        require(LenientJson.asLong(response.path("base_state_revision")) == LenientJson.asLong(previous.path("revision")),
                "stale state revision");
        String message = LenientJson.asText(response.path("message")).strip();
        require(!message.isBlank() && message.codePointCount(0, message.length()) <= maxChars,
                "message exceeds current length limit");
        require(OpeningQuestion.questionCount(message) <= 1,
                "at most one question");
        require(QUOTED_SENTENCES.matcher(message).replaceAll("quote").split("[.!?。！？]+(?:\\s|$)").length <= maxSentences,
                "too many sentences");
        require(!message.contains("```") && !message.contains("source_refs"), "internal output in message");
        require(!finishRequired || "finish".equals(LenientJson.asText(response.path("flow"))), "must finish now");
        require(!finishRequired || OpeningQuestion.questionCount(message) == 0, "closing response must not ask a question");
        Map<String, JsonNode> catalog = catalog(sources);
        catalog.put(coachId, source(coachId, "coach_message", message));
        validateReferences(response, catalog);
        ObjectNode state = previous.deepCopy();
        if (!response.path("context_update").isNull()) {
            JsonNode context = response.get("context_update");
            JsonNode direction = context.path("direction");
            if (!direction.isNull() && !"coach_proposed".equals(LenientJson.asText(direction.path("origin")))) {
                requireActor(direction.path("source_refs"), catalog, null);
            }
            JsonNode focus = context.path("focus");
            if (!focus.isNull()) {
                require(!focus.path("evidence_refs").isEmpty(), "focus needs evidence");
                boolean observedMaterial = false;
                for (JsonNode ref : focus.path("evidence_refs")) {
                    String kind = LenientJson.asText(catalog.get(LenientJson.asText(ref)).path("kind"));
                    observedMaterial |= kind.equals("video_observation") || kind.equals("video_utterance");
                    require(kind.equals("video_observation") || kind.equals("video_utterance") || kind.equals("record_limitation"),
                            "focus must refer to observed material");
                }
                require(observedMaterial, "a limitation alone cannot establish a focus; retain or clear focus");
                if (!focus.path("utterance_ref").isNull()) {
                    require("video_utterance".equals(LenientJson.asText(catalog.get(LenientJson.asText(focus.path("utterance_ref")))
                            .path("kind"))), "focus utterance must be a transcript");
                }
            }
            for (String field : List.of("reading", "scene_context")) {
                rejectOnlyCurrentCoach(context.path(field), coachId);
            }
            state.set("context", context.deepCopy());
        }
        Map<String, JsonNode> proposals = indexed(state.path("proposals"), "proposal_id");
        Set<String> modified = new LinkedHashSet<>();
        for (JsonNode change : response.path("proposal_changes")) {
            String kind = LenientJson.asText(change.path("kind"));
            if (kind.equals("create")) {
                JsonNode proposal = change.path("proposal");
                String id = LenientJson.asText(proposal.path("proposal_id"));
                require(id.equals(proposalId) && !proposals.containsKey(id), "invalid new proposal id");
                require("proposed".equals(LenientJson.asText(proposal.path("selection")))
                        && proposal.path("selection_refs").isEmpty()
                        && "active".equals(LenientJson.asText(proposal.path("lifecycle")))
                        && proposal.path("retirement_refs").isEmpty(), "new proposal cannot invent history");
                for (String field : List.of("instruction", "comparison", "keep")) {
                    JsonNode text = proposal.path(field);
                    if (!text.isNull()) {
                        require(message.contains(LenientJson.asText(text.path("text"))), "undisclosed practice instruction");
                        require(contains(text.path("source_refs"), coachId), "new instruction needs displayed message");
                    }
                }
                rejectOnlyCurrentCoachRefs(proposal.path("basis_refs"), coachId);
                proposals.put(id, proposal.deepCopy());
            } else {
                String id = LenientJson.asText(change.path("proposal_id"));
                require(proposals.containsKey(id) && modified.add(kind + ":" + id), "unknown or repeated proposal change");
                ObjectNode proposal = (ObjectNode) proposals.get(id);
                require("active".equals(LenientJson.asText(proposal.path("lifecycle"))), "retired proposal is immutable");
                if (kind.equals("select")) {
                    requireActor(change.path("source_refs"), catalog, actorId);
                    proposal.put("selection", "selected");
                    proposal.set("selection_refs", change.path("source_refs").deepCopy());
                } else {
                    if ("declined".equals(LenientJson.asText(change.path("reason")))) {
                        requireActor(change.path("source_refs"), catalog, actorId);
                    }
                    proposal.put("lifecycle", LenientJson.asText(change.path("reason")));
                    proposal.set("retirement_refs", change.path("source_refs").deepCopy());
                }
            }
        }
        List<JsonNode> active = proposals.values().stream()
                .filter(p -> "active".equals(LenientJson.asText(p.path("lifecycle")))).toList();
        require(active.size() <= 1, "only one active proposal");
        if (!active.isEmpty()) {
            JsonNode p = active.getFirst();
            require(!state.path("context").path("direction").isNull()
                    && !state.path("context").path("focus").isNull(), "practice needs direction and focus");
            if (!previous.path("context").path("direction").equals(state.path("context").path("direction"))
                    || !previous.path("context").path("focus").equals(state.path("context").path("focus"))) {
                require(!indexed(previous.path("proposals"), "proposal_id")
                        .containsKey(LenientJson.asText(p.path("proposal_id"))), "changed focus requires reconsidering previous proposal");
            }
            state.put("active_proposal_id", LenientJson.asText(p.path("proposal_id")));
        } else {
            state.putNull("active_proposal_id");
        }
        ArrayNode nextProposals = state.putArray("proposals");
        proposals.values().forEach(nextProposals::add);
        Map<String, JsonNode> attempts = indexed(state.path("attempts"), "attempt_id");
        for (JsonNode change : response.path("attempt_changes")) {
            JsonNode attempt = change.path("attempt");
            String id = LenientJson.asText(attempt.path("attempt_id"));
            JsonNode old = attempts.get(id);
            require(old != null || id.equals(attemptId), "invalid attempt id");
            JsonNode proposal = proposals.get(LenientJson.asText(attempt.path("proposal_id")));
            require(proposal != null, "unknown attempt proposal");
            require(attempt.path("instruction").equals(proposal.path("instruction")), "attempt instruction changed");
            if (old != null) {
                require(old.path("proposal_id").equals(attempt.path("proposal_id")), "cannot reassign attempt");
                require(!"reported_tried".equals(LenientJson.asText(old.path("execution")))
                        || "reported_tried".equals(LenientJson.asText(attempt.path("execution"))), "cannot erase execution history");
            }
            if (!"unknown".equals(LenientJson.asText(attempt.path("execution")))) {
                requireActor(attempt.path("execution_refs"), catalog, actorId);
            }
            if (!attempt.path("result").isNull()) {
                requireActor(attempt.path("result").path("statement").path("source_refs"), catalog, actorId);
            }
            attempts.put(id, attempt.deepCopy());
        }
        ArrayNode nextAttempts = state.putArray("attempts");
        attempts.values().forEach(nextAttempts::add);
        if (!response.path("style_update").isNull()) {
            state.put("response_style", LenientJson.asText(response.path("style_update")));
        }
        state.put("revision", LenientJson.asLong(previous.path("revision")) + 1);
        // Keep only cited sources. A later request cannot cite material it was never given.
        validateReferences(state, catalog);
        Set<String> cited = references(state);
        ArrayNode savedSources = state.putArray("source_catalog");
        cited.forEach(id -> savedSources.add(catalog.get(id)));
        return state;
    }

    static void validateReferences(JsonNode value, Map<String, JsonNode> catalog) {
        for (String id : references(value)) {
            require(catalog.containsKey(id), "reference was not delivered to this call");
        }
    }

    static Set<String> references(JsonNode value) {
        Set<String> refs = new LinkedHashSet<>();
        collect(value, refs);
        return refs;
    }

    private static void collect(JsonNode value, Set<String> refs) {
        if (value.isArray()) { value.forEach(v -> collect(v, refs)); return; }
        if (!value.isObject()) { return; }
        value.properties().forEach(entry -> {
            String key = entry.getKey();
            if (key.equals("source_catalog")) { return; }
            if (key.endsWith("_refs")) { entry.getValue().forEach(v -> refs.add(LenientJson.asText(v))); }
            else if (key.equals("utterance_ref") && !entry.getValue().isNull()) {
                refs.add(LenientJson.asText(entry.getValue()));
            } else { collect(entry.getValue(), refs); }
        });
    }

    static Map<String, JsonNode> catalog(JsonNode array) { return indexed(array, "id"); }

    private static Map<String, JsonNode> indexed(JsonNode array, String field) {
        Map<String, JsonNode> result = new LinkedHashMap<>();
        array.forEach(item -> result.put(LenientJson.asText(item.path(field)), item.deepCopy()));
        return result;
    }

    static ObjectNode source(String id, String kind, String text) {
        return StructuredJson.MAPPER.createObjectNode().put("id", id).put("kind", kind).put("text", text)
                .putNull("record_id").putNull("record_version").putNull("start_ms").putNull("end_ms");
    }

    private static void requireActor(JsonNode refs, Map<String, JsonNode> catalog, String currentId) {
        require(!refs.isEmpty(), "actor evidence required");
        if (currentId != null) { require(contains(refs, currentId), "change needs the current actor message"); }
        for (JsonNode ref : refs) {
            JsonNode source = catalog.get(LenientJson.asText(ref));
            String text = LenientJson.asText(source.path("text")).strip();
            require(Set.of("actor_message", "actor_input").contains(LenientJson.asText(source.path("kind"))),
                    "coach text cannot prove actor intent or execution");
            require(!ClosingIntent.isClosing(text)
                    && !text.matches("(?iu)[\\s.!?]*(네+|예|응|어|음|좋아|좋아요|그래|알겠어|알겠어요|알았어|고마워|정리해줘|정리해주세요|여기까지 정리해줘|ㄱㄱ|ㅇㅇ|ㅇㅋ|오케이|ok|yes)[\\s.!?]*"),
                    "acknowledgment or closure cannot prove selection or execution");
        }
    }

    private static void rejectOnlyCurrentCoach(JsonNode node, String coachId) {
        Set<String> refs = references(node);
        require(refs.isEmpty() || refs.stream().anyMatch(id -> !id.equals(coachId)), "unsupported interpretation");
    }

    private static void rejectOnlyCurrentCoachRefs(JsonNode refs, String coachId) {
        require(!refs.isEmpty() && java.util.stream.StreamSupport.stream(refs.spliterator(), false)
                .anyMatch(ref -> !LenientJson.asText(ref).equals(coachId)), "practice needs prior evidence");
    }

    private static boolean contains(JsonNode refs, String id) {
        for (JsonNode ref : refs) { if (LenientJson.asText(ref).equals(id)) { return true; } }
        return false;
    }

    static void require(boolean condition, String message) {
        if (!condition) { throw new IllegalArgumentException(message); }
    }
}
