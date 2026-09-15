package com.acttub.actingapi.feature.coach.app;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.domain.ClosingIntent;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.observation.VideoRecord;
import com.acttub.actingapi.platform.ledger.ExternalOperationExecution;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.platform.observability.LlmTokens;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** One visible reply may perform bounded lookups against the immutable text record. */
final class StructuredCoachEngine {
    private static final String PROMPT = StructuredJson.instructions(
            StructuredJson.textResource("/coaching/coach-prompt.txt") + "\n" + OpeningQuestion.PROMPT,
            "layer2_dialogue_turn");
    private static final int MAX_CALLS = 4;
    private static final int MAX_LOOKUPS = 2;
    private final TextGenerator generate;
    private final FailureReporter failures;
    private final LlmTelemetry telemetry;
    private final CoachRecordLookup records = new CoachRecordLookup();

    StructuredCoachEngine(TextGenerator generate, FailureReporter failures, LlmTelemetry telemetry) {
        this.generate = generate;
        this.failures = failures;
        this.telemetry = telemetry;
    }

    CoachResult turn(CoachSessionSnapshot session, String actorText, UUID operationId) {
        ObjectNode state = session.coachingState() == null ? CoachingStateReducer.empty()
                : ((ObjectNode) session.coachingState()).deepCopy();
        CoachingStateReducer.require(state.path("revision").asLong() == session.stateRevision(), "stored revision mismatch");
        long replyCount = session.turns().stream().filter(t -> "ai".equals(t.role())).count();
        boolean actorFinished = actorText != null && (ClosingIntent.isClosing(actorText)
                || actorText.strip().matches("(?:(?:여기까지|지금까지|오늘은|오늘 대화|이번 대화)\\s*)?정리(?:해줘|해 줘|해주세요|해 주세요)[.!?\\s]*"));
        boolean finish = actorFinished || replyCount >= 9;
        String actorId = actorText == null ? null : turnId(session, session.turns().size());
        String coachId = turnId(session, session.turns().size() + (actorText == null ? 0 : 1));
        String style = responseStyle(state.path("response_style").asText(), actorText);
        int maxChars = switch (style) { case "brief" -> 80; case "expanded" -> 300; default -> 120; };
        int maxSentences = style.equals("expanded") ? 4 : style.equals("brief") ? 1 : 2;
        ObjectNode input = input(session, state, actorText, actorId, operationId);
        ObjectNode view = records.initial(session.observationPack());
        input.set("record_view", view);
        input.put("output_contract", "acttub.layer2_turn.v2");
        input.putObject("reserved_ids").put("coach_message_id", coachId);
        ObjectNode controls = input.putObject("controls").put("max_message_chars", maxChars)
                .put("max_sentences", maxSentences).put("max_questions", finish ? 0 : 1)
                .put("coach_replies_remaining", Math.max(0, 10 - replyCount))
                .put("lookup_calls_remaining", MAX_LOOKUPS).put("finish_required", finish);
        int lookups = 0;
        Instant deadline = Instant.now().plusSeconds(100);
        for (int call = 0; call < MAX_CALLS && Instant.now().isBefore(deadline); call++) {
            controls.put("lookup_calls_remaining", call == MAX_CALLS - 1 ? 0 : MAX_LOOKUPS - lookups);
            controls.put("min_questions", 0);
            try {
                JsonNode response = StructuredJson.parse(recorded(session, input, call));
                StructuredJson.validate("layer2_dialogue_turn", response);
                CoachingStateReducer.require(response.path("base_state_revision").asLong() == session.stateRevision(),
                        "stale state revision");
                if ("lookup".equals(response.path("action").asText())) {
                    CoachingStateReducer.require(controls.path("lookup_calls_remaining").asInt() > 0,
                            "lookup budget exhausted; respond with available evidence");
                    lookups++;
                    JsonNode result = records.lookup(session.observationPack(), response.path("request"));
                    view = records.merge(view, result);
                    input.set("record_view", view);
                    input.remove("validation_error");
                    continue;
                }
                ObjectNode next = DialogueState.apply(state, response, deliveredSources(input), input.path("user_message"),
                        coachId, maxChars, maxSentences, finish,
                        input.path("last_exchange").path("coach_message").path("text").asText());
                // Explicit brevity requests persist even when the model omits style_update.
                next.put("response_style", responseStyle(state.path("response_style").asText(), actorText));
                boolean done = "finish".equals(response.path("flow").asText());
                return result(session, actorText, response.path("message").asText().strip(), next,
                        done ? (actorFinished ? "actor_finished" : replyCount >= 9 ? "turn_budget" : "interrupted") : null);
            } catch (RuntimeException failure) {
                failures.report(failure, FailureKind.EXTERNAL,
                        new FailureContext("StructuredCoachEngine.validation", operationId));
                // Never echo an unvalidated model response to the actor or the next prompt.
                input.put("validation_error", failure instanceof IllegalArgumentException
                        ? failure.getMessage() : "generation unavailable; return a valid response using available evidence");
            }
        }
        ObjectNode retained = state.deepCopy();
        retained.put("revision", session.stateRevision() + 1).put("response_style", style);
        String message = finish
                ? "지금까지 이야기한 내용으로 정리할게요."
                : actorText == null
                        ? OpeningQuestion.fallback(false) : "지금은 이 구간을 더 확인하기 어려워요.";
        return result(session, actorText, message, retained, finish ? "system_failure" : null);
    }

    private static ObjectNode input(CoachSessionSnapshot session, JsonNode state, String actorText,
            String actorId, UUID operationId) {
        ObjectNode input = StructuredJson.MAPPER.createObjectNode().put("request_id", operationId.toString())
                .put("session_id", session.sessionId().toString());
        if (actorText == null) { input.putNull("user_message"); }
        else { input.putObject("user_message").put("id", actorId).put("role", "actor").put("text", actorText); }
        input.set("actor_context", VideoRecord.isRecord(session.observationPack())
                ? session.observationPack().path("actor_context").deepCopy() : StructuredJson.MAPPER.createObjectNode());
        ObjectNode visibleState = state.deepCopy();
        visibleState.remove("source_catalog");
        visibleState.remove(List.of("proposals", "attempts", "active_proposal_id"));
        visibleState.set("context", DialogueState.context(state));
        input.set("coaching_state", visibleState);
        input.set("state_sources", state.path("source_catalog").deepCopy());
        if (!session.prior().isEmpty()) {
            input.set("prior_context", StructuredJson.MAPPER.valueToTree(session.prior()));
        }
        ArrayNode messages = input.putArray("recent_messages");
        for (int i = 0; i < session.turns().size(); i++) {
            CoachTurnSnapshot turn = session.turns().get(i);
            messages.addObject().put("id", turnId(session, i)).put("role", turn.role()).put("text", turn.text());
        }
        ObjectNode exchange = input.putObject("last_exchange");
        exchange.putNull("coach_message");
        for (JsonNode message : messages) {
            if ("ai".equals(message.path("role").asText())) exchange.set("coach_message", message.deepCopy());
        }
        exchange.set("actor_message", input.path("user_message").deepCopy());
        return input;
    }

    private static ArrayNode deliveredSources(JsonNode input) {
        Map<String, JsonNode> catalog = new LinkedHashMap<>();
        for (JsonNode list : List.of(input.path("state_sources"), input.path("record_view").path("source_catalog"))) {
            list.forEach(s -> catalog.put(s.path("id").asText(), s));
        }
        input.path("recent_messages").forEach(m -> catalog.put(m.path("id").asText(), messageSource(m)));
        JsonNode actor = input.path("user_message");
        if (!actor.isNull()) { catalog.put(actor.path("id").asText(), messageSource(actor)); }
        ArrayNode sources = StructuredJson.MAPPER.createArrayNode();
        catalog.values().forEach(sources::add);
        return sources;
    }

    private static ObjectNode messageSource(JsonNode message) {
        return CoachingStateReducer.source(message.path("id").asText(),
                "actor".equals(message.path("role").asText()) ? "actor_message" : "coach_message",
                message.path("text").asText());
    }

    private static String responseStyle(String current, String actorText) {
        if (actorText == null) { return current; }
        if (actorText.matches("(?s).*(길어|짧게|간단히|한 ?문장|간결).*")) { return "brief"; }
        if (actorText.matches("(?s).*(자세히|자세하게|상세히|길게 설명).*")) { return "expanded"; }
        return current;
    }

    private CoachResult result(CoachSessionSnapshot session, String actorText, String message,
            ObjectNode state, String endReason) {
        List<CoachTurnSnapshot> turns = new ArrayList<>(session.turns());
        if (actorText != null) { turns.add(new CoachTurnSnapshot("actor", actorText)); }
        turns.add(new CoachTurnSnapshot("ai", message));
        CoachSessionSnapshot next = session.withTurns(turns).withCoachingState(session.experienceVersion(),
                state.path("revision").asLong(), state, endReason == null ? "open" : "closed",
                endReason == null ? "" : endReason);
        ObjectNode handoff = null;
        if (endReason != null) {
            handoff = StructuredJson.MAPPER.createObjectNode().put("schema_version", "acttub.coach_handoff.v2")
                    .put("session_id", session.sessionId().toString()).put("state_revision", next.stateRevision())
                    .put("end_reason", endReason);
            handoff.set("record_ref", VideoRecord.isRecord(session.observationPack())
                    ? VideoRecord.reference(session.observationPack()) : StructuredJson.MAPPER.nullNode());
            handoff.set("context", DialogueState.context(state));
            Map<String, JsonNode> sources = CoachingStateReducer.catalog(state.path("source_catalog"));
            ArrayNode conversation = handoff.putArray("conversation");
            for (int i = 0; i < turns.size(); i++) {
                CoachTurnSnapshot turn = turns.get(i);
                String id = turnId(session, i);
                ObjectNode item = conversation.addObject().put("id", id).put("role", turn.role()).put("text", turn.text());
                sources.put(id, messageSource(item));
            }
            ArrayNode catalog = handoff.putArray("source_catalog");
            sources.values().forEach(catalog::add);
            StructuredJson.validate("coach_handoff_v2", handoff);
        }
        return new CoachResult(next, new CoachReply(message, endReason == null ? "continue" : "complete", handoff));
    }

    private String recorded(CoachSessionSnapshot session, JsonNode input, int call) {
        Instant started = Instant.now();
        String text = input.toString();
        try {
            ExternalOperationExecution.externalCall("model");
            var generated = generate.generate(PROMPT, text);
            telemetry.record(new LlmCall(call == 0 ? LlmStep.COACH_TURN : LlmStep.COACH_REGENERATION,
                    session.practiceSessionId(), session.userId(), generated.model(), PROMPT + "\n" + text,
                    generated.text(), generated.usage() == null ? LlmTokens.unknown() : LlmTokens.of(
                            generated.usage().prompt(), generated.usage().completion(), generated.usage().total()),
                    started, Duration.between(started, Instant.now()), null,
                    LlmCall.metadata("contract", "three_layers_v1", "state_revision", String.valueOf(session.stateRevision()))));
            return generated.text();
        } catch (RuntimeException failure) {
            telemetry.record(new LlmCall(LlmStep.COACH_TURN, session.practiceSessionId(), session.userId(), "",
                    PROMPT + "\n" + text, "", LlmTokens.unknown(), started, Duration.between(started, Instant.now()),
                    failure.getClass().getSimpleName(), LlmCall.metadata("contract", "three_layers_v1")));
            throw failure;
        }
    }

    static String turnId(CoachSessionSnapshot session, int index) {
        return "turn:" + session.sessionId() + ":" + index;
    }
}
