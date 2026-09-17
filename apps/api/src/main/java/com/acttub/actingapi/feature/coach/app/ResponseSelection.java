package com.acttub.actingapi.feature.coach.app;

import java.util.Map;
import com.fasterxml.jackson.databind.JsonNode;
import static com.acttub.actingapi.feature.coach.app.CoachingStateReducer.require;

/** Checks the response contract, not whether an actor's interpretation is correct. */
final class ResponseSelection {
    private ResponseSelection() { }

    static void validate(JsonNode response, Map<String, JsonNode> sources, boolean finishRequired) {
        JsonNode link = response.path("reply_link");
        JsonNode selection = link.path("selection");
        boolean closing = "close".equals(link.path("move").asText());
        boolean finish = "finish".equals(response.path("flow").asText());
        require(closing == finish, "close move and finish flow must agree");
        require(!finishRequired || closing, "respond to closure by ending, not asking another question");
        boolean question = !selection.path("question").isNull();
        require(OpeningQuestion.questionCount(response.path("message").asText()) == 0 || question,
                "a question needs missing information and how its answer changes the help");
        require(!closing || !question, "closing must not request more information");
        for (JsonNode ref : selection.path("known_refs")) {
            require(sources.containsKey(ref.asText()), "selection must use delivered knowledge");
        }
        if ("assess".equals(link.path("move").asText())) {
            boolean observed = false;
            for (JsonNode ref : link.path("evidence_refs")) {
                JsonNode source = sources.get(ref.asText());
                observed |= source != null && "video_observation".equals(source.path("kind").asText());
            }
            require(observed, "delivery assessment needs an observation; script or actor intention alone is insufficient");
        }
    }
}
