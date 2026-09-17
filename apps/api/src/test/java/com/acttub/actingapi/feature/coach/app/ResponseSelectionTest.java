package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import java.util.List;
import java.util.Map;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class ResponseSelectionTest {
    private ObjectNode response(String message, String move, String flow) {
        ObjectNode input = StructuredJson.MAPPER.createObjectNode();
        input.putObject("user_message").put("id", "actor:1").put("text", "붙잡으려는 거야. 어떻게 하면 돼?");
        input.set("coaching_state", CoachingStateReducer.empty());
        ObjectNode response = StructuredCoachEngineTest.respond(input, message, flow);
        ((ObjectNode) response.path("reply_link")).put("move", move);
        return response;
    }

    @Test void questionWithoutUsefulInformationIsRejected() {
        ObjectNode response = response("상대는 누구인가요?", "clarify", "continue");
        ((ObjectNode) response.path("reply_link").path("selection")).putNull("question");
        assertThatThrownBy(() -> ResponseSelection.validate(response, Map.of(), false))
                .hasMessageContaining("question needs");
    }

    @Test void unavailableKnowledgeAndTranscriptOnlyAssessmentAreRejected() {
        ObjectNode response = response("붙잡으려는 뜻이 전달됐어요.", "assess", "continue");
        ((ObjectNode) response.path("reply_link")).putArray("evidence_refs").add("u1");
        Map<String, JsonNode> transcript = Map.of("u1", CoachingStateReducer.source("u1", "video_utterance", "가지 마"));
        assertThatThrownBy(() -> ResponseSelection.validate(response, transcript, false)).hasMessageContaining("observation");
        Map<String, JsonNode> observation = Map.of("u1", CoachingStateReducer.source("u1", "video_observation", "말 뒤 상대 쪽으로 손을 뻗는다"));
        assertThatCode(() -> ResponseSelection.validate(response, observation, false)).doesNotThrowAnyException();
        ((ObjectNode) response.path("reply_link").path("selection")).putArray("known_refs").add("invented");
        assertThatThrownBy(() -> ResponseSelection.validate(response, observation, false)).hasMessageContaining("delivered knowledge");
    }

    @Test void closingCannotAskAndMustAgreeWithFlow() {
        assertThatThrownBy(() -> ResponseSelection.validate(response("알겠어요.", "explain", "finish"), Map.of(), true))
                .hasMessageContaining("must agree");
        assertThatThrownBy(() -> ResponseSelection.validate(response("더 볼까요?", "close", "finish"), Map.of(), true))
                .hasMessageContaining("must not request");
        assertThatCode(() -> ResponseSelection.validate(response("오늘은 여기까지 정리할게요.", "close", "finish"), Map.of(), true))
                .doesNotThrowAnyException();
    }

    @Test void concreteAdviceIsAcceptedWithoutRecordingPracticeExecution() {
        ObjectNode previous = CoachingStateReducer.empty();
        ObjectNode actor = StructuredJson.MAPPER.createObjectNode().put("id", "actor:1").put("text", "붙잡으려는 거야. 어떻게 하면 돼?");
        var sources = StructuredJson.MAPPER.createArrayNode().add(CoachingStateReducer.source("actor:1", "actor_message", actor.path("text").asText()));
        for (String move : List.of("suggest", "simplify", "extend")) {
            ObjectNode response = response("부탁을 끝낸 뒤 설명을 덧붙이지 말고 상대의 답을 기다려보세요.", move, "continue");
            ObjectNode next = DialogueState.apply(previous, response, sources, actor, "coach:1", 120, 2, false, "");
            assertThat(next.path("last_reply").path("move").asText()).isEqualTo(move);
            assertThat(next.path("proposals")).isEmpty();
            assertThat(next.path("attempts")).isEmpty();
        }
    }
}
