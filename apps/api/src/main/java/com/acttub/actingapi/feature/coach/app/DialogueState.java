package com.acttub.actingapi.feature.coach.app;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.feature.report.app.ActorExperience;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import static com.acttub.actingapi.feature.coach.app.CoachingStateReducer.require;
import com.acttub.actingapi.platform.json.LenientJson;

/** Dialogue transitions have no operation capable of assigning practice or claiming execution. */
final class DialogueState {
    private static final Pattern QUOTED_TEXT = Pattern.compile("“[^”]*”|‘[^’]*’|\"[^\"]*\"|'[^']*'");
    private static final Pattern SELECT_PASSAGE = Pattern.compile(
            "(?:어느|어떤|몇\\s*번째)[^.!?？。\\n]{0,35}(?:대사|문장|끝말|대목|구간)"
            + "|(?:대사|문장|끝말|대목|구간)[^.!?？。\\n]{0,35}(?:어느|어떤|몇\\s*번째|하나|고르|골라|선택)");

    private DialogueState() { }

    /** Reject the observed experience-as-video paraphrases; attribution is not visual evidence. */
    static boolean presentsExperienceAsObservation(String message) {
        for (String sentence : QUOTED_TEXT.matcher(message).replaceAll("").split("(?<=[.!?？。])|\\n")) {
            if (sentence.contains("?") || sentence.contains("？")) continue;
            boolean subjective = sentence.matches("(?s).*(?:편안함|감각).*");
            boolean observed = sentence.matches("(?s).*(?:보여요|보였어요|드러나요|드러났어요|세\\s*문장.*이어졌어요|전달됐어요|전달됐습니다).*");
            if (subjective && observed) return true;
        }
        return false;
    }

    /** Narrow guard for a reproduced scope-reset question, not a semantic quality classifier. */
    static boolean asksToSelectPassage(String message) {
        String unquoted = QUOTED_TEXT.matcher(message).replaceAll("");
        for (String sentence : unquoted.split("(?<=[.!?？。])|\\n")) {
            if ((sentence.contains("?") || sentence.contains("？")
                    || sentence.matches("(?s).*(?:골라|고르|선택).*(?:주세요|세요).*"))
                    && SELECT_PASSAGE.matcher(sentence).find()) return true;
        }
        return false;
    }

    static ObjectNode context(JsonNode state) {
        ObjectNode context = state.path("context").deepCopy();
        context.putNull("reading");
        // An old coach suggestion must never become the actor's direction in the new dialogue.
        if ("coach_proposed".equals(LenientJson.asText(context.path("direction").path("origin")))) {
            context.putNull("direction");
        }
        ObjectNode scene = (ObjectNode) context.path("scene_context");
        for (String key : List.of("situation", "character_goal", "partner_action")) {
            if ("coach_proposed".equals(LenientJson.asText(scene.path(key).path("origin")))) scene.putNull(key);
        }
        return context;
    }

    static ObjectNode apply(JsonNode previous, JsonNode response, JsonNode sources,
            JsonNode userMessage, String coachId, int maxChars, int maxSentences,
            boolean finishRequired, String previousMessage) {
        StructuredJson.validate("layer2_dialogue_respond", response);
        Map<String, JsonNode> catalog = CoachingStateReducer.catalog(sources);
        JsonNode link = response.path("reply_link");
        if (userMessage.isNull()) {
            require(link.path("user_message_id").isNull() && link.path("actor_quote").isNull(), "opening has no actor answer");
            require(Set.of("open", "close").contains(LenientJson.asText(link.path("move"))), "opening move required");
        } else {
            String quote = LenientJson.asText(link.path("actor_quote"));
            require(link.path("user_message_id").equals(userMessage.path("id")), "reply must address latest actor message: copy response_constraints.user_message_id exactly");
            require(!quote.isBlank() && LenientJson.asText(userMessage.path("text")).contains(quote), "reply quote must come from latest answer");
            require(!"open".equals(LenientJson.asText(link.path("move"))), "cannot restart dialogue after an answer");
        }
        for (JsonNode id : link.path("evidence_refs")) {
            JsonNode source = catalog.get(LenientJson.asText(id));
            require(source != null && Set.of("video_observation", "video_utterance", "record_limitation")
                    .contains(LenientJson.asText(source.path("kind"))), "reply evidence must be delivered video material: use only IDs in response_constraints.allowed_video_refs; request_id and session_id are not evidence");
        }
        String message = LenientJson.asText(response.path("message")).strip();
        ResponseSelection.validate(response, catalog, finishRequired);
        require(!presentsExperienceAsObservation(message),
                "배우가 말한 편안함·감각을 영상에서 보인 사실로 단정하지 않는다. 경험은 배우가 느낀 것으로 받아주고, "
                + "영상의 말소리·움직임은 별도 문장으로 설명한다. 둘의 관계를 만들어내지 않는다.");
        if (!userMessage.isNull() && "whole_video".equals(LenientJson.asText(previous.path("context").path("focus").path("scope")))) {
            require(!asksToSelectPassage(message),
                    "전체 초점에서 대사·문장·끝말 하나를 고르게 하지 않는다. 배우의 답을 반영해 전체 개선 방향을 설명한다. "
                    + "필요하면 배우가 말한 어려움이나 원하는 전달 방식만 확인하고, 이미 확인됐다면 질문을 생략한다.");
        }
        if (userMessage.isNull() && !finishRequired) {
            boolean material = catalog.values().stream().anyMatch(OpeningQuestion::videoSource);
            require(!material || "continue".equals(LenientJson.asText(response.path("flow"))),
                    "video evidence is available; open with a meaningful question instead of closing");
            if ("continue".equals(LenientJson.asText(response.path("flow")))) {
                List<String> failures = OpeningQuestion.failures(message);
                require(failures.isEmpty(), String.join(" ", failures));
                boolean anchored = false;
                for (JsonNode id : link.path("evidence_refs")) anchored |= OpeningQuestion.videoSource(catalog.get(LenientJson.asText(id)));
                require(anchored, "opening question must cite a delivered video observation or utterance");
                JsonNode focus = response.path("context_update").path("focus");
                require(focus.isObject(), "save the opening focus so the next answer continues the same subject");
                boolean shared = false;
                for (JsonNode id : focus.path("evidence_refs")) {
                    for (JsonNode replyRef : link.path("evidence_refs")) shared |= id.equals(replyRef);
                }
                require(shared, "opening focus must include the evidence used by its question");
            }
        }
        require(!message.equals(previousMessage), "do not repeat the previous coach response");
        require(!message.matches("(?s).*(?:찍어\\s*보|촬영해\\s*보|해본\\s*뒤|해\\s*보고.{0,15}(?:알려|보고)|비교.{0,10}실험).*"),
                "practice assignments belong in the final note");
        require(!message.matches("(?s).*(?:^|\\n)\\s*(?:#{1,6} |[-*] |[0-9]+\\. ).*")
                && !message.contains("**"), "use plain conversational sentences");
        String unquoted = message;
        var quotes = Pattern.compile("“([^”]+)”|\"([^\"]+)\"").matcher(message);
        while (quotes.find()) {
            String quote = quotes.group(1) != null ? quotes.group(1) : quotes.group(2);
            if (catalog.values().stream().anyMatch(s -> Set.of("actor_message", "actor_input")
                    .contains(LenientJson.asText(s.path("kind"))) && LenientJson.asText(s.path("text")).contains(quote))) {
                unquoted = unquoted.replace(quotes.group(), "");
            }
        }
        for (String word : List.of("망설", "읽힘", "전달의 결", "정서의 흐름", "에너지", "밀도")) {
            require(!unquoted.contains(word), "replace vague interpretation with an observed action");
        }
        require(!OpeningQuestion.vagueReading(unquoted), "replace vague reading or weight metaphors with a concrete description");
        JsonNode update = response.path("context_update");
        if (!update.isNull()) {
            validateActorQuote(update.path("direction"), catalog);
            for (JsonNode ref : update.path("direction").path("source_refs")) {
                require(!ActorExperience.onlyExperience(LenientJson.asText(catalog.get(LenientJson.asText(ref)).path("text"))),
                        "경험만 말한 발화를 목표로 저장하지 않는다. 편했어·급했어는 direction의 근거가 아니다. "
                        + "배우가 원하는 방향을 말하지 않았다면 direction은 null로 둔다.");
            }
            for (String key : List.of("situation", "character_goal", "partner_action")) {
                validateActorQuote(update.path("scene_context").path(key), catalog);
            }
        }
        return transition(previous, response, sources, userMessage, coachId, maxChars, maxSentences, finishRequired);
    }

    /** Route generation uses data integrity checks, not the old keyword-driven coaching policy. */
    static ObjectNode applyRouted(JsonNode previous, JsonNode response, JsonNode sources,
            JsonNode userMessage, String coachId, int maxChars, int maxSentences, boolean finishRequired) {
        StructuredJson.validate("layer2_dialogue_respond", response);
        Map<String, JsonNode> catalog = CoachingStateReducer.catalog(sources);
        for (JsonNode ref : response.path("reply_link").path("evidence_refs")) {
            JsonNode source = catalog.get(LenientJson.asText(ref));
            require(source != null && Set.of("video_observation", "video_utterance", "record_limitation")
                    .contains(LenientJson.asText(source.path("kind"))), "reply evidence must be delivered video material");
        }
        JsonNode update = response.path("context_update");
        if (!update.isNull()) {
            validateActorQuote(update.path("direction"), catalog);
            for (String key : List.of("situation", "character_goal", "partner_action")) {
                validateActorQuote(update.path("scene_context").path(key), catalog);
            }
        }
        if (userMessage.isNull() && !finishRequired) {
            require(response.path("context_update").path("focus").isObject(), "opening must retain its grounded focus");
            require(!response.path("reply_link").path("evidence_refs").isEmpty(), "opening needs video evidence");
        }
        return transition(previous, response, sources, userMessage, coachId, maxChars, maxSentences, finishRequired);
    }

    private static ObjectNode transition(JsonNode previous, JsonNode response, JsonNode sources,
            JsonNode userMessage, String coachId, int maxChars, int maxSentences, boolean finishRequired) {
        Map<String, JsonNode> catalog = CoachingStateReducer.catalog(sources);
        JsonNode link = response.path("reply_link");
        String message = LenientJson.asText(response.path("message")).strip();
        // Reuse revision, length and reference validation, without exposing legacy practice operations.
        ObjectNode adapted = response.deepCopy();
        adapted.remove("reply_link");
        adapted.putArray("proposal_changes");
        adapted.putArray("attempt_changes");
        ObjectNode base = previous.deepCopy();
        base.set("context", context(previous));
        // Preserve old history separately; active proposals must not constrain a new conversation focus.
        JsonNode oldProposals = base.path("proposals").deepCopy();
        JsonNode oldAttempts = base.path("attempts").deepCopy();
        for (JsonNode proposal : oldProposals) {
            if ("active".equals(LenientJson.asText(proposal.path("lifecycle")))) {
                ((ObjectNode) proposal).put("lifecycle", "needs_review");
                ((ObjectNode) proposal).putArray("retirement_refs").add(coachId);
            }
        }
        base.putArray("proposals"); base.putArray("attempts"); base.putNull("active_proposal_id");
        ObjectNode next = CoachingStateReducer.apply(base, adapted, sources,
                LenientJson.asText(userMessage.path("id"), null), coachId, "", "", maxChars, maxSentences, finishRequired);
        next.set("proposals", oldProposals); next.set("attempts", oldAttempts);
        next.set("last_reply", link.deepCopy());
        // Keep delivered limitations with the evidence. A later layer must see uncertainty too.
        catalog.put(coachId, CoachingStateReducer.source(coachId, "coach_message", message));
        var retained = next.putArray("source_catalog");
        Set<String> refs = CoachingStateReducer.references(next);
        catalog.values().stream().filter(s -> refs.contains(LenientJson.asText(s.path("id")))
                || "record_limitation".equals(LenientJson.asText(s.path("kind")))).forEach(retained::add);
        return next;
    }

    private static void validateActorQuote(JsonNode value, Map<String, JsonNode> catalog) {
        if (value.isNull()) return;
        require(!"coach_proposed".equals(LenientJson.asText(value.path("origin"))), "actor direction must not be invented");
        boolean quoted = false;
        for (JsonNode ref : value.path("source_refs")) {
            JsonNode source = catalog.get(LenientJson.asText(ref));
            require(source != null && Set.of("actor_input", "actor_message").contains(LenientJson.asText(source.path("kind"))),
                    "scene and direction require actor evidence");
            require(!LenientJson.asText(source.path("text")).strip().matches("(?iu)[\\s.!?]*(모르겠(?:어|어요|다)|몰라(?:요)?|ㅁㄹ|네+|응|ㅇㅇ|ㅇㅋ|음|글쎄(?:요)?)[\\s.!?]*"),
                    "uncertainty or acknowledgment is not an actor direction");
            quoted |= LenientJson.asText(source.path("text")).contains(LenientJson.asText(value.path("text")));
        }
        require(quoted, "keep the actor's own words in context: scene_context와 direction의 text는 배우 원문에서 그대로 복사한다. 문장 끝이나 조사를 바꾸지 않는다. 요약은 message에만 쓴다.");
    }
}
