package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

/** 대화 응답의 저장 전 검사: 어떤 규칙을 어겼는지 밝혀 거절하고, 지키면 이전 실천 기록을 보존한 채 대화 상태만 옮긴다. */
class DialogueStateRulesTest {
    static final String ANSWER = "붙잡고 싶었는데 애원하긴 싫었어.";
    final ObjectNode actor = StructuredJson.MAPPER.createObjectNode().put("id", "m1").put("text", ANSWER);
    final ArrayNode sources = StructuredJson.MAPPER.createArrayNode()
            .add(CoachingStateReducer.source("u1", "video_utterance", "가지 마"))
            .add(CoachingStateReducer.source("e1", "video_observation", "마지막 음절이 길게 이어진다."))
            .add(CoachingStateReducer.source("l1", "record_limitation", "손은 화면 밖이다."))
            .add(CoachingStateReducer.source("m1", "actor_message", ANSWER))
            .add(CoachingStateReducer.source("m0", "actor_message", "모르겠어"));

    static ObjectNode response(String message, String flow, String move) {
        ObjectNode output = StructuredJson.MAPPER.createObjectNode().put("action", "respond").put("base_state_revision", 0)
                .put("message", message).putNull("context_update").putNull("style_update").put("flow", flow);
        ObjectNode link = output.putObject("reply_link").put("move", move);
        ObjectNode selection = link.putObject("selection").put("need", "장면 이해").put("blocker", "scene_understanding");
        selection.putArray("known_refs");
        if (OpeningQuestion.questionCount(message) > 0) selection.putObject("question")
                .put("missing_information", "현재 장면의 이유").put("help_if_answered", "장면에 맞는 설명을 연결한다");
        else selection.putNull("question");
        link.putArray("evidence_refs");
        return output;
    }

    ObjectNode reply(String message) {
        ObjectNode output = response(message, "continue", "explain");
        ((ObjectNode) output.path("reply_link")).put("user_message_id", "m1").put("actor_quote", "애원하긴 싫었어");
        return output;
    }

    ObjectNode opening(String message) {
        ObjectNode output = response(message, "continue", "open");
        ((ObjectNode) output.path("reply_link")).putNull("user_message_id").putNull("actor_quote");
        ((ArrayNode) output.path("reply_link").path("evidence_refs")).add("e1");
        ObjectNode context = CoachingStateReducer.empty().path("context").deepCopy();
        context.putObject("focus").put("label", "말끝").putNull("utterance_ref").putArray("evidence_refs").add("e1");
        output.set("context_update", context);
        return output;
    }

    ObjectNode withDirection(ObjectNode output, String text, String origin, String... refs) {
        ObjectNode context = CoachingStateReducer.empty().path("context").deepCopy();
        ArrayNode array = context.putObject("direction").put("text", text).put("origin", origin).putArray("source_refs");
        for (String ref : refs) array.add(ref);
        output.set("context_update", context);
        return output;
    }

    ObjectNode apply(JsonNode response) {
        return DialogueState.apply(CoachingStateReducer.empty(), response, sources, actor, "c1", 200, 3, false, "이전 답");
    }

    void rejects(JsonNode response, String message) {
        assertThatThrownBy(() -> apply(response)).isInstanceOf(IllegalArgumentException.class).hasMessage(message);
    }

    @Test void aReplyMustQuoteTheLatestAnswerAndNotRestart() {
        ObjectNode foreign = reply("그 마음을 살려 볼게요.");
        ((ObjectNode) foreign.path("reply_link")).put("actor_quote", "다른 말");
        rejects(foreign, "reply quote must come from latest answer");
        ObjectNode restart = reply("그 마음을 살려 볼게요.");
        ((ObjectNode) restart.path("reply_link")).put("move", "open");
        rejects(restart, "cannot restart dialogue after an answer");
    }

    @Test void replyEvidenceMustBeDeliveredVideoMaterial() {
        String rule = "reply evidence must be delivered video material: use only IDs in response_constraints.allowed_video_refs; request_id and session_id are not evidence";
        ObjectNode unknown = reply("그 마음을 살려 볼게요.");
        ((ArrayNode) unknown.path("reply_link").path("evidence_refs")).add("request-1");
        rejects(unknown, rule);
        ObjectNode actorWords = reply("그 마음을 살려 볼게요.");
        ((ArrayNode) actorWords.path("reply_link").path("evidence_refs")).add("m1");
        rejects(actorWords, rule);
        ObjectNode limitation = reply("손은 화면 밖이라 볼 수 없어요.");
        ((ArrayNode) limitation.path("reply_link").path("evidence_refs")).add("l1");
        assertThat(apply(limitation).path("last_reply").path("evidence_refs").toString()).isEqualTo("[\"l1\"]");
    }

    @Test void messageMustBeNewPlainAndConcrete() {
        rejects(reply("이전 답"), "do not repeat the previous coach response");
        rejects(reply("- 말끝을 짧게 해요."), "use plain conversational sentences");
        rejects(reply("말끝을 **짧게** 해요."), "use plain conversational sentences");
        rejects(reply("말끝에 에너지가 모자라요."), "replace vague interpretation with an observed action");
        rejects(reply("말끝이 부탁처럼 읽혀요."), "replace vague reading or weight metaphors with a concrete description");
    }

    @Test void theActorsOwnWordsMayBeQuotedEvenWhenTheyAreVague() {
        sources.add(CoachingStateReducer.source("m2", "actor_message", "에너지가 모자랐어"));
        ObjectNode state = apply(reply("“에너지가 모자랐어”라고 하셨죠. 마지막 음절이 길게 이어졌어요."));
        assertThat(state.path("last_reply").path("actor_quote").asText()).isEqualTo("애원하긴 싫었어");
        assertThat(state.path("revision").asInt()).isEqualTo(1);
        rejects(reply("“에너지가 넘쳤어”라고 느끼셨군요."), "replace vague interpretation with an observed action");
    }

    @Test void directionMustBeTheActorsOwnClearWords() {
        rejects(withDirection(reply("붙잡고 싶은 마음이군요."), "붙잡고 싶었는데", "actor_stated", "e1"),
                "scene and direction require actor evidence");
        rejects(withDirection(reply("붙잡고 싶은 마음이군요."), "모르겠어", "actor_stated", "m0"),
                "uncertainty or acknowledgment is not an actor direction");
        assertThatThrownBy(() -> apply(withDirection(reply("붙잡고 싶은 마음이군요."), "붙잡고 싶다", "actor_stated", "m1")))
                .hasMessageStartingWith("keep the actor's own words in context");
        ObjectNode state = apply(withDirection(reply("붙잡고 싶은 마음이군요."), "붙잡고 싶었는데", "actor_stated", "m1"));
        assertThat(state.path("context").path("direction").path("text").asText()).isEqualTo("붙잡고 싶었는데");
    }

    @Test void sceneContextNeedsActorWordsToo() {
        ObjectNode output = reply("붙잡고 싶은 마음이군요.");
        ObjectNode context = CoachingStateReducer.empty().path("context").deepCopy();
        ((ObjectNode) context.path("scene_context")).putObject("character_goal").put("text", "붙잡고 싶었는데")
                .put("origin", "actor_stated").putArray("source_refs").add("e1");
        output.set("context_update", context);
        rejects(output, "scene and direction require actor evidence");
    }

    @Test void coachSuggestionsFromAnEarlierDialogueAreDroppedAndActivePracticeIsMarkedForReview() {
        ObjectNode previous = CoachingStateReducer.empty();
        ObjectNode context = (ObjectNode) previous.path("context");
        context.putObject("direction").put("text", "코치가 제안한 방향").put("origin", "coach_proposed").putArray("source_refs").add("c0");
        ((ObjectNode) context.path("scene_context")).putObject("situation").put("text", "코치가 짐작한 상황")
                .put("origin", "coach_proposed").putArray("source_refs").add("c0");
        ((ObjectNode) context.path("scene_context")).putObject("partner_action").put("text", "떠나려 한다")
                .put("origin", "actor_stated").putArray("source_refs").add("m0");
        ((ArrayNode) previous.path("proposals")).addObject().put("proposal_id", "p1").put("lifecycle", "active");
        ((ArrayNode) previous.path("proposals")).addObject().put("proposal_id", "p0").put("lifecycle", "declined");

        ObjectNode fresh = DialogueState.context(previous);
        assertThat(fresh.path("direction").isNull()).isTrue();
        assertThat(fresh.path("scene_context").path("situation").isNull()).isTrue();
        assertThat(fresh.path("scene_context").path("partner_action").path("text").asText()).isEqualTo("떠나려 한다");

        ObjectNode next = DialogueState.applyRouted(previous, reply("그 마음을 살려 볼게요."), sources, actor, "c1", 200, 3, false);
        assertThat(next.path("proposals").get(0).path("lifecycle").asText()).isEqualTo("needs_review");
        assertThat(next.path("proposals").get(0).path("retirement_refs").toString()).isEqualTo("[\"c1\"]");
        assertThat(next.path("proposals").get(1).path("lifecycle").asText()).isEqualTo("declined");
        assertThat(next.path("source_catalog").findValuesAsText("id")).contains("c1", "l1");
    }

    @Test void anOpeningHasNoActorAnswerAndMustOpenOrClose() {
        ObjectNode answered = opening("말끝이 길게 이어졌어요. 일부러 늘였나요?");
        ((ObjectNode) answered.path("reply_link")).put("user_message_id", "m1");
        assertThatThrownBy(() -> DialogueState.apply(CoachingStateReducer.empty(), answered, sources,
                StructuredJson.MAPPER.nullNode(), "c1", 200, 3, false, "")).hasMessage("opening has no actor answer");
        ObjectNode explain = opening("말끝이 길게 이어졌어요. 일부러 늘였나요?");
        ((ObjectNode) explain.path("reply_link")).put("move", "explain");
        assertThatThrownBy(() -> DialogueState.apply(CoachingStateReducer.empty(), explain, sources,
                StructuredJson.MAPPER.nullNode(), "c1", 200, 3, false, "")).hasMessage("opening move required");
    }

    @Test void anOpeningWithVideoMaterialMustAskInsteadOfClosing() {
        ObjectNode closing = response("오늘은 여기까지 할게요.", "finish", "close");
        ((ObjectNode) closing.path("reply_link")).putNull("user_message_id").putNull("actor_quote");
        assertThatThrownBy(() -> DialogueState.apply(CoachingStateReducer.empty(), closing, sources,
                StructuredJson.MAPPER.nullNode(), "c1", 200, 3, false, ""))
                .hasMessage("video evidence is available; open with a meaningful question instead of closing");
        var noMaterial = StructuredJson.MAPPER.createArrayNode().add(CoachingStateReducer.source("l1", "record_limitation", "화면이 어둡다."));
        ObjectNode closed = DialogueState.apply(CoachingStateReducer.empty(), closing, noMaterial,
                StructuredJson.MAPPER.nullNode(), "c1", 200, 3, false, "");
        assertThat(closed.path("last_reply").path("move").asText()).isEqualTo("close");
        assertThat(closed.path("source_catalog").findValuesAsText("id")).containsExactlyInAnyOrder("l1");
    }

    @Test void routedOpeningMustKeepItsFocusAndEvidence() {
        ObjectNode noFocus = opening("말끝이 길게 이어졌어요.");
        noFocus.putNull("context_update");
        assertThatThrownBy(() -> DialogueState.applyRouted(CoachingStateReducer.empty(), noFocus, sources,
                StructuredJson.MAPPER.nullNode(), "c1", 200, 3, false)).hasMessage("opening must retain its grounded focus");
        ObjectNode noEvidence = opening("말끝이 길게 이어졌어요.");
        ((ArrayNode) noEvidence.path("reply_link").path("evidence_refs")).removeAll();
        assertThatThrownBy(() -> DialogueState.applyRouted(CoachingStateReducer.empty(), noEvidence, sources,
                StructuredJson.MAPPER.nullNode(), "c1", 200, 3, false)).hasMessage("opening needs video evidence");
        ObjectNode foreign = opening("말끝이 길게 이어졌어요.");
        ((ArrayNode) foreign.path("reply_link").path("evidence_refs")).add("m1");
        assertThatThrownBy(() -> DialogueState.applyRouted(CoachingStateReducer.empty(), foreign, sources,
                StructuredJson.MAPPER.nullNode(), "c1", 200, 3, false)).hasMessage("reply evidence must be delivered video material");
        ObjectNode state = DialogueState.applyRouted(CoachingStateReducer.empty(), opening("말끝이 길게 이어졌어요."), sources,
                StructuredJson.MAPPER.nullNode(), "c1", 200, 3, false);
        assertThat(state.path("context").path("focus").path("evidence_refs").toString()).isEqualTo("[\"e1\"]");
    }

    @Test void routedRepliesStillRejectInventedDirectionAndScene() {
        assertThatThrownBy(() -> DialogueState.applyRouted(CoachingStateReducer.empty(),
                withDirection(reply("붙잡고 싶은 마음이군요."), "붙잡고 싶었는데", "actor_stated", "e1"), sources, actor, "c1", 200, 3, false))
                .hasMessage("scene and direction require actor evidence");
        ObjectNode scene = reply("붙잡고 싶은 마음이군요.");
        ObjectNode context = CoachingStateReducer.empty().path("context").deepCopy();
        ((ObjectNode) context.path("scene_context")).putObject("situation").put("text", "애원하긴 싫었어")
                .put("origin", "actor_stated").putArray("source_refs").add("m1");
        scene.set("context_update", context);
        ObjectNode state = DialogueState.applyRouted(CoachingStateReducer.empty(), scene, sources, actor, "c1", 200, 3, false);
        assertThat(state.path("context").path("scene_context").path("situation").path("text").asText()).isEqualTo("애원하긴 싫었어");
    }

    @Test void questionsAndQuotedLinesAreNotReadAsObservedExperience() {
        assertThat(DialogueState.presentsExperienceAsObservation("그 편안함이 영상에서 보여요？")).isFalse();
        assertThat(DialogueState.presentsExperienceAsObservation("“편안함이 보여요.”라는 대사였죠.")).isFalse();
    }
}
