package com.acttub.actingapi.feature.coach.app;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;

import static com.acttub.actingapi.feature.coach.app.CoachingStateReducer.require;

/** Dialogue transitions have no operation capable of assigning practice or claiming execution. */
final class DialogueState {
    private static final Pattern QUOTED_TEXT = Pattern.compile("“[^”]*”|‘[^’]*’|\"[^\"]*\"|'[^']*'");
    private static final Pattern SELECT_PASSAGE = Pattern.compile(
            "(?:어느|어떤|몇\\s*번째)[^.!?？。\\n]{0,35}(?:대사|문장|끝말|대목|구간)"
            + "|(?:대사|문장|끝말|대목|구간)[^.!?？。\\n]{0,35}(?:어느|어떤|몇\\s*번째|하나|고르|골라|선택)");

    private DialogueState() { }

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
        if ("coach_proposed".equals(context.path("direction").path("origin").asText())) {
            context.putNull("direction");
        }
        ObjectNode scene = (ObjectNode) context.path("scene_context");
        for (String key : List.of("situation", "character_goal", "partner_action")) {
            if ("coach_proposed".equals(scene.path(key).path("origin").asText())) scene.putNull(key);
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
            require(Set.of("open", "close").contains(link.path("move").asText()), "opening move required");
        } else {
            String quote = link.path("actor_quote").asText();
            require(link.path("user_message_id").equals(userMessage.path("id")), "reply must address latest actor message");
            require(!quote.isBlank() && userMessage.path("text").asText().contains(quote), "reply quote must come from latest answer");
            require(!"open".equals(link.path("move").asText()), "cannot restart dialogue after an answer");
        }
        for (JsonNode id : link.path("evidence_refs")) {
            JsonNode source = catalog.get(id.asText());
            require(source != null && Set.of("video_observation", "video_utterance", "record_limitation")
                    .contains(source.path("kind").asText()), "reply evidence must be delivered video material");
        }
        String message = response.path("message").asText().strip();
        if (!userMessage.isNull() && "whole_video".equals(previous.path("context").path("focus").path("scope").asText())) {
            require(!asksToSelectPassage(message),
                    "전체 초점에서 대사·문장·끝말 하나를 고르게 하지 않는다. 배우의 답을 반영해 전체 개선 방향을 설명한다. "
                    + "필요하면 배우가 말한 어려움이나 원하는 전달 방식만 확인하고, 이미 확인됐다면 질문을 생략한다.");
        }
        if (userMessage.isNull() && !finishRequired) {
            boolean material = catalog.values().stream().anyMatch(OpeningQuestion::videoSource);
            require(!material || "continue".equals(response.path("flow").asText()),
                    "video evidence is available; open with a meaningful question instead of closing");
            if ("continue".equals(response.path("flow").asText())) {
                List<String> failures = OpeningQuestion.failures(message);
                require(failures.isEmpty(), String.join(" ", failures));
                boolean anchored = false;
                for (JsonNode id : link.path("evidence_refs")) anchored |= OpeningQuestion.videoSource(catalog.get(id.asText()));
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
        require(!message.matches("(?s).*(?:해\\s*보(?:세요|고)|해본\\s*뒤|말해\\s*보|찍어\\s*보|촬영해\\s*보|연습해\\s*보|바꿔\\s*보|유지해\\s*보).*"),
                "practice assignments belong in the final note");
        require(!message.matches("(?s).*(?:^|\\n)\\s*(?:#{1,6} |[-*] |[0-9]+\\. ).*")
                && !message.contains("**"), "use plain conversational sentences");
        String unquoted = message;
        var quotes = Pattern.compile("“([^”]+)”|\"([^\"]+)\"").matcher(message);
        while (quotes.find()) {
            String quote = quotes.group(1) != null ? quotes.group(1) : quotes.group(2);
            if (catalog.values().stream().anyMatch(s -> Set.of("actor_message", "actor_input")
                    .contains(s.path("kind").asText()) && s.path("text").asText().contains(quote))) {
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
            for (String key : List.of("situation", "character_goal", "partner_action")) {
                validateActorQuote(update.path("scene_context").path(key), catalog);
            }
        }
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
            if ("active".equals(proposal.path("lifecycle").asText())) {
                ((ObjectNode) proposal).put("lifecycle", "needs_review");
                ((ObjectNode) proposal).putArray("retirement_refs").add(coachId);
            }
        }
        base.putArray("proposals"); base.putArray("attempts"); base.putNull("active_proposal_id");
        ObjectNode next = CoachingStateReducer.apply(base, adapted, sources,
                userMessage.path("id").asText(null), coachId, "", "", maxChars, maxSentences, finishRequired);
        next.set("proposals", oldProposals); next.set("attempts", oldAttempts);
        next.set("last_reply", link.deepCopy());
        // Keep delivered limitations with the evidence. A later layer must see uncertainty too.
        catalog.put(coachId, CoachingStateReducer.source(coachId, "coach_message", message));
        var retained = next.putArray("source_catalog");
        Set<String> refs = CoachingStateReducer.references(next);
        catalog.values().stream().filter(s -> refs.contains(s.path("id").asText())
                || "record_limitation".equals(s.path("kind").asText())).forEach(retained::add);
        return next;
    }

    private static void validateActorQuote(JsonNode value, Map<String, JsonNode> catalog) {
        if (value.isNull()) return;
        require(!"coach_proposed".equals(value.path("origin").asText()), "actor direction must not be invented");
        boolean quoted = false;
        for (JsonNode ref : value.path("source_refs")) {
            JsonNode source = catalog.get(ref.asText());
            require(source != null && Set.of("actor_input", "actor_message").contains(source.path("kind").asText()),
                    "scene and direction require actor evidence");
            require(!source.path("text").asText().strip().matches("(?iu)[\\s.!?]*(모르겠(?:어|어요|다)|몰라(?:요)?|ㅁㄹ|네+|응|ㅇㅇ|ㅇㅋ|음|글쎄(?:요)?)[\\s.!?]*"),
                    "uncertainty or acknowledgment is not an actor direction");
            quoted |= source.path("text").asText().contains(value.path("text").asText());
        }
        require(quoted, "keep the actor's own words in context");
    }
}
