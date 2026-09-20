package com.acttub.actingapi.feature.coach.app;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.regex.Pattern;

import com.acttub.actingapi.integration.llm.GenerationOptions;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.platform.ledger.ExternalOperationExecution;
import com.acttub.actingapi.platform.observability.ActorNameRedaction;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.platform.observability.LlmTokens;
import com.acttub.actingapi.platform.web.OutputLanguage;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

/** Luna classifies; Java selects one prompt; the final call only edits wording. */
final class CoachingPipeline {
    static final String CLASSIFIER_MODEL = "gpt-5.6-luna";
    private static final String CLASSIFIER = resource("classifier");
    private static final String COMMON = resource("common");
    private static final String POLISH = resource("polish");
    private static final String CONTRACT = resource("contract") + "\n" + draftSchema();
    private static final JsonNode ROUTE_SCHEMA = StructuredJson.parse("""
            {"type":"object","additionalProperties":false,"properties":{"route":{"type":"string",
            "enum":["understand_scene","assess_performance","design_performance","adjust_performance"]}},"required":["route"]}
            """);
    private static final JsonNode MESSAGE_SCHEMA = StructuredJson.parse("""
            {"type":"object","additionalProperties":false,"properties":{"message":{"type":"string"}},"required":["message"]}
            """);
    private static final Pattern PROTECTED = Pattern.compile("[“‘][^”’]*[”’]|\"[^\"]*\"|[0-9]+(?:[.:][0-9]+)*");
    private final TextGenerator generator;
    private final LlmTelemetry telemetry;

    CoachingPipeline(TextGenerator generator, LlmTelemetry telemetry) {
        this.generator = generator;
        this.telemetry = telemetry;
    }

    CoachingRoute classify(CoachSessionSnapshot session, JsonNode input) {
        ObjectNode request = StructuredJson.MAPPER.createObjectNode();
        request.set("video_record", input.path("video_record"));
        request.set("conversation_history", input.path("recent_messages"));
        request.set("user_message", input.path("user_message"));
        request.set("actor_context", input.path("actor_context"));
        JsonNode result = StructuredJson.parse(call(session, LlmStep.COACH_ROUTE, CLASSIFIER, request,
                new GenerationOptions(CLASSIFIER_MODEL, "low", 512, "coaching_route", ROUTE_SCHEMA), null));
        if (result.size() != 1 || !result.path("route").isTextual()) {
            throw new IllegalArgumentException("invalid coaching route response");
        }
        return CoachingRoute.parse(result.path("route").asText());
    }

    static String prompt(CoachingRoute route, boolean finish) {
        // No combined routing instructions are sent to the message generator.
        String task = finish ? resource("closing") : switch (route) {
            case UNDERSTAND_SCENE -> resource("understand_scene");
            case ASSESS_PERFORMANCE -> resource("assess_performance");
            case DESIGN_PERFORMANCE -> resource("design_performance");
            case ADJUST_PERFORMANCE -> resource("adjust_performance");
        };
        return COMMON + "\n" + task + "\n" + CONTRACT;
    }

    ObjectNode generate(CoachSessionSnapshot session, ObjectNode input, CoachingRoute route, boolean finish, int attempt) {
        ObjectNode payload = input.deepCopy();
        payload.remove(List.of("dialogue_progress", "output_contract", "request_id", "session_id"));
        // 완성된 프로필이 실린 호출에만 프로필 지시가 붙는다. 프로필이 없으면 프롬프트는 prompt(route, finish) 그대로다
        // (CONTRACT.md §7-2 "부재 시 동일성"). 분류·다듬기 호출은 프로필을 받지 않는다 — 이름이 실리는 호출은 이것 하나다.
        // 답할 말 지시(SOMA-544)는 맨 마지막이다. 한국어면 아무것도 붙지 않는다.
        String prompt = OutputLanguage.apply(prompt(route, finish)
                + (payload.has("actor_profile") ? StructuredCoachEngine.ACTOR_PROFILE_INSTRUCTION : ""));
        JsonNode draft = StructuredJson.parse(call(session, attempt == 0 ? LlmStep.COACH_TURN : LlmStep.COACH_REGENERATION,
                prompt, payload, new GenerationOptions(null, "low", 3000, null, null), route));
        if (draft.size() != 3 || !draft.path("message").isTextual() || !draft.has("context_update")
                || !draft.path("evidence_refs").isArray()) throw new IllegalArgumentException("invalid coaching draft");
        ObjectNode response = StructuredJson.MAPPER.createObjectNode().put("action", "respond")
                .put("base_state_revision", input.path("coaching_state").path("revision").asLong())
                .put("message", draft.path("message").asText()).put("flow", finish ? "finish" : "continue")
                .putNull("style_update");
        response.set("context_update", draft.path("context_update"));
        ObjectNode link = response.putObject("reply_link");
        boolean opening = input.path("user_message").isNull();
        link.put("move", finish ? "close" : opening ? "open" : route.move);
        link.set("user_message_id", opening ? StructuredJson.MAPPER.nullNode() : input.path("user_message").path("id"));
        if (opening) link.putNull("actor_quote");
        else {
            String actor = input.path("user_message").path("text").asText();
            // Storage keeps a short exact excerpt; classification/generation still see the entire message.
            link.put("actor_quote", actor.substring(0, actor.offsetByCodePoints(0, Math.min(100, actor.codePointCount(0, actor.length())))));
        }
        link.set("evidence_refs", draft.path("evidence_refs"));
        // Legacy storage metadata is stamped by code, never used as a second classifier.
        ObjectNode selection = link.putObject("selection").put("need", finish ? "대화 마무리" : route.id)
                .put("blocker", "none");
        selection.putArray("known_refs");
        selection.putNull("question");
        return response;
    }

    String polish(CoachSessionSnapshot session, String message, int maxChars, CoachingRoute route) {
        // No video, conversation, or state mutation capability is passed to this editor.
        ObjectNode input = StructuredJson.MAPPER.createObjectNode().put("message", message).put("max_message_chars", maxChars);
        JsonNode result = StructuredJson.parse(call(session, LlmStep.COACH_POLISH, POLISH, input,
                new GenerationOptions(CLASSIFIER_MODEL, "low", 1000, "coaching_message", MESSAGE_SCHEMA), route));
        if (result.size() != 1 || !result.path("message").isTextual()) throw new IllegalArgumentException("invalid polish response");
        String edited = result.path("message").asText().strip();
        if (edited.isBlank() || edited.codePointCount(0, edited.length()) > maxChars
                || OpeningQuestion.questionCount(edited) != OpeningQuestion.questionCount(message)
                || !protectedParts(edited).equals(protectedParts(message))) throw new IllegalArgumentException("polish changed protected content");
        return edited;
    }

    private String call(CoachSessionSnapshot session, LlmStep step, String prompt, JsonNode input,
            GenerationOptions options, CoachingRoute route) {
        Instant start = Instant.now();
        String payload = input.toString();
        // 모델에는 payload 를 그대로 보내고, 바깥으로 나가는 기록에서만 배우의 이름을 가린다 (CONTRACT.md §7-2).
        String recorded = prompt + "\n" + (input.has("actor_profile") ? ActorNameRedaction.inJson(payload) : payload);
        var metadata = LlmCall.metadata("contract", "luna_routes_v1", "route", route == null ? "" : route.id);
        try {
            ExternalOperationExecution.externalCall("model");
            var output = generator.generate(prompt, payload, options);
            var usage = output.usage();
            telemetry.record(new LlmCall(step, session.practiceSessionId(), session.userId(), output.model(), recorded,
                    output.text(), usage == null ? LlmTokens.unknown() : LlmTokens.of(usage.prompt(), usage.completion(), usage.total()),
                    start, Duration.between(start, Instant.now()), null, metadata));
            return output.text();
        } catch (RuntimeException failure) {
            telemetry.record(new LlmCall(step, session.practiceSessionId(), session.userId(), options.model() == null ? "" : options.model(),
                    recorded, "", LlmTokens.unknown(), start, Duration.between(start, Instant.now()),
                    failure.getClass().getSimpleName(), metadata));
            throw failure;
        }
    }

    private static List<String> protectedParts(String message) {
        return PROTECTED.matcher(message).results().map(java.util.regex.MatchResult::group).toList();
    }

    private static String resource(String name) { return StructuredJson.textResource("/coaching/routes/" + name + ".txt"); }

    private static ObjectNode draftSchema() {
        ObjectNode context = StructuredJson.schema("dialogue_context");
        JsonNode definitions = context.remove("$defs");
        context.remove("$schema");
        ObjectNode schema = StructuredJson.MAPPER.createObjectNode().put("type", "object").put("additionalProperties", false);
        ObjectNode props = schema.putObject("properties");
        props.putObject("message").put("type", "string").put("minLength", 1).put("maxLength", 400);
        props.putObject("context_update").putArray("anyOf").add(context).addObject().put("type", "null");
        props.putObject("evidence_refs").put("type", "array").putObject("items").put("type", "string");
        schema.putArray("required").add("message").add("context_update").add("evidence_refs");
        schema.set("$defs", definitions);
        return schema;
    }
}
