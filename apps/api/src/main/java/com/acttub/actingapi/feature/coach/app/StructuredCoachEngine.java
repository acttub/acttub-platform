package com.acttub.actingapi.feature.coach.app;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

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
    /**
     * 입력에 {@code actor_profile} 이 있을 때만 붙는 지시. 기본 프롬프트를 조건 없이 바꾸지 않는 것은
     * 부재 시 동일성 때문이다 — 프로필이 없는 세션의 모델 입력은 전과 글자 하나 다르지 않아야 한다.
     */
    static final String ACTOR_PROFILE_INSTRUCTION = "\n\n[actor_profile]\n"
            + "actor_profile 은 배우가 직접 저장한 현재 정보다(이름·성별·만 나이·추구하는 방향·연기 경력·최종 목표). "
            + "영상·인물의 근거가 아니므로 video_refs·knowledge_refs 로 인용하지 않고, 다시 입력하도록 묻지 않는다. "
            + "prior_context 나 이전 대화와 다르면 actor_profile 의 값을 우선한다. 설명의 깊이와 용어를 경력에 맞춘다. "
            + "이름은 필요할 때만 호칭으로 쓴다 — 한국어로는 이름 뒤에 '님'을 붙이고, 영어로는 이름 그대로 부른다.";
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
        boolean actorFinished = DialogueProgress.actorFinished(actorText);
        boolean finish = actorFinished || replyCount >= 9;
        String actorId = actorText == null ? null : turnId(session, session.turns().size());
        String coachId = turnId(session, session.turns().size() + (actorText == null ? 0 : 1));
        String style = responseStyle(state.path("response_style").asText(), actorText);
        int maxChars = switch (style) { case "brief" -> 80; case "expanded" -> 300; default -> 120; };
        int maxSentences = style.equals("expanded") ? 4 : style.equals("brief") ? 1 : 3;
        if (actorText == null && style.equals("normal")) {
            maxChars = 100;
            maxSentences = 2;
        }
        ObjectNode input = input(session, state, actorText, actorId, operationId);
        ObjectNode view = records.initial(session.observationPack());
        input.set("record_view", view);
        input.set("dialogue_progress", DialogueProgress.controls(input).put("allow_finish", finish));
        input.put("output_contract", "acttub.layer2_turn.v2");
        input.putObject("reserved_ids").put("coach_message_id", coachId);
        ObjectNode controls = input.putObject("controls").put("max_message_chars", maxChars)
                .put("max_sentences", maxSentences).put("max_questions",
                        finish || input.path("dialogue_progress").path("explain_instead_of_repeating_question").asBoolean() ? 0 : 1)
                .put("coach_replies_remaining", Math.max(0, 10 - replyCount))
                .put("lookup_calls_remaining", MAX_LOOKUPS).put("finish_required", finish);
        ArrayNode validationErrors = input.putArray("validation_errors");
        int lookups = 0;
        Instant deadline = Instant.now().plusSeconds(100);
        for (int call = 0; call < MAX_CALLS && Instant.now().isBefore(deadline); call++) {
            controls.put("lookup_calls_remaining", call == MAX_CALLS - 1 ? 0 : MAX_LOOKUPS - lookups);
            controls.put("min_questions", 0);
            ObjectNode constraints = input.putObject("response_constraints");
            constraints.set("user_message_id", input.path("user_message").path("id").isMissingNode()
                    ? StructuredJson.MAPPER.nullNode() : input.path("user_message").path("id"));
            ArrayNode videoRefs = constraints.putArray("allowed_video_refs");
            ArrayNode knowledgeRefs = constraints.putArray("allowed_knowledge_refs");
            for (JsonNode source : deliveredSources(input)) {
                knowledgeRefs.add(source.path("id"));
                if (List.of("video_observation", "video_utterance", "record_limitation").contains(source.path("kind").asText())) {
                    videoRefs.add(source.path("id"));
                }
            }
            try {
                var references = new DialogueReferences(deliveredSources(input), coachId);
                ObjectNode modelInput = (ObjectNode) references.toModel(input);
                modelInput.remove(List.of("request_id", "session_id"));
                JsonNode response = !finish && input.path("dialogue_progress").path("unclear_correction").asBoolean()
                        ? DialogueProgress.correctionTargetReply(input)
                        : !finish && input.path("dialogue_progress").path("unobservable_hand_requested").asBoolean()
                        ? DialogueProgress.observationLimitReply(input)
                        : references.fromModel(StructuredJson.parse(recorded(session, modelInput, call)));
                StructuredJson.validate("layer2_dialogue_turn", response);
                CoachingStateReducer.require(response.path("base_state_revision").asLong() == session.stateRevision(),
                        "stale state revision");
                if ("lookup".equals(response.path("action").asText())) {
                    CoachingStateReducer.require(controls.path("lookup_calls_remaining").asInt() > 0,
                            "lookup budget exhausted; respond with available evidence");
                    lookups++;
                    JsonNode result = records.lookup(session.observationPack(), response.path("request"));
                    view = records.merge(view, result);
                    records.refreshCoverage(session.observationPack(), view);
                    input.set("record_view", view);
                    input.remove("validation_error");
                    continue;
                }
                FocusCoverage.validate(response.path("context_update").path("focus"), session.observationPack(), view);
                DialogueProgress.validate(response, input.path("dialogue_progress"));
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
                String error = failure instanceof IllegalArgumentException
                        ? failure.getMessage() : "generation unavailable; return a valid response using available evidence";
                input.put("validation_error", error);
                if (!validationErrors.toString().contains(StructuredJson.MAPPER.getNodeFactory().textNode(error).toString())) {
                    validationErrors.add(error);
                }
            }
        }
        if (!finish) throw new CoachReplyUnavailable();
        ObjectNode retained = state.deepCopy();
        retained.put("revision", session.stateRevision() + 1).put("response_style", style);
        return result(session, actorText, "지금까지 이야기한 내용으로 정리할게요.", retained, "system_failure");
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
        // 완성된 프로필이 있을 때만 싣는다. 없으면 키 자체가 없다 — 모델 입력이 전과 같다.
        if (session.actorProfile() != null) {
            input.set("actor_profile", StructuredJson.MAPPER.valueToTree(session.actorProfile()));
        }
        PriorContext prior = session.priorForModel();
        if (!prior.isEmpty()) {
            input.set("prior_context", StructuredJson.MAPPER.valueToTree(prior));
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
        String prompt = PROMPT + DialogueProgress.turnInstruction(input.path("dialogue_progress"))
                + (input.has("actor_profile") ? ACTOR_PROFILE_INSTRUCTION : "");
        try {
            ExternalOperationExecution.externalCall("model");
            var generated = generate.generate(prompt, text);
            telemetry.record(new LlmCall(call == 0 ? LlmStep.COACH_TURN : LlmStep.COACH_REGENERATION,
                    session.practiceSessionId(), session.userId(), generated.model(), prompt + "\n" + text,
                    generated.text(), generated.usage() == null ? LlmTokens.unknown() : LlmTokens.of(
                            generated.usage().prompt(), generated.usage().completion(), generated.usage().total()),
                    started, Duration.between(started, Instant.now()), null,
                    LlmCall.metadata("contract", "three_layers_v1", "state_revision", String.valueOf(session.stateRevision()))));
            return generated.text();
        } catch (RuntimeException failure) {
            telemetry.record(new LlmCall(LlmStep.COACH_TURN, session.practiceSessionId(), session.userId(), "",
                    prompt + "\n" + text, "", LlmTokens.unknown(), started, Duration.between(started, Instant.now()),
                    failure.getClass().getSimpleName(), LlmCall.metadata("contract", "three_layers_v1")));
            throw failure;
        }
    }

    static String turnId(CoachSessionSnapshot session, int index) {
        return "turn:" + session.sessionId() + ":" + index;
    }
}
