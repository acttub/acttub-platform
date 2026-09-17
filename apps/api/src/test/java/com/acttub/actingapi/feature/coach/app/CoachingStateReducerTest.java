package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class CoachingStateReducerTest {
    JsonNode turn(int i) { return StructuredJson.resource("/coaching/turns.json").get(i).deepCopy(); }
    ObjectNode output(int i) { return (ObjectNode) turn(i).path("model_output"); }
    ArrayNode sources(int i) {
        JsonNode input = turn(i).path("input");
        ArrayNode sources = StructuredJson.MAPPER.createArrayNode();
        sources.addAll((ArrayNode) input.path("state_sources"));
        sources.addAll((ArrayNode) input.path("record_view").path("source_catalog"));
        return sources;
    }
    ObjectNode apply(JsonNode old, JsonNode output, int i) {
        JsonNode ids = turn(i).path("input").path("reserved_ids");
        return CoachingStateReducer.apply(old, output, sources(i), i == 0 ? null : "m" + i,
                ids.path("coach_message_id").asText(), ids.path("new_proposal_id").asText(),
                ids.path("new_attempt_id").asText(), 120, 2, i == 2);
    }
    ObjectNode proposed() { return apply(apply(CoachingStateReducer.empty(), output(0), 0), output(1), 1); }

    @Test void actualDirectionAndDisplayedInstructionsSurviveWithoutInventedExecution() {
        ObjectNode proposed = proposed();
        assertThat(proposed.path("context").path("direction").path("origin").asText()).isEqualTo("actor_stated");
        assertThat(proposed.path("proposals").get(0).path("selection").asText()).isEqualTo("proposed");
        assertThat(proposed.path("attempts")).isEmpty();
        ObjectNode finish = output(2);
        ((ObjectNode) finish.path("attempt_changes").get(0).path("attempt")).put("attempt_id", "a2");
        ObjectNode selected = apply(proposed, finish, 2);
        assertThat(selected.path("revision").asInt()).isEqualTo(3);
        assertThat(selected.path("attempts").get(0).path("execution").asText()).isEqualTo("not_tried");
        assertThat(selected.path("attempts").get(0).path("result").isNull()).isTrue();
    }
    @Test void rejectsUndeliveredEvidenceAndHiddenHomework() {
        ObjectNode response = output(0);
        ((ObjectNode) response.path("context_update").path("focus")).putArray("evidence_refs").add("not_delivered");
        assertThatThrownBy(() -> apply(CoachingStateReducer.empty(), response, 0)).hasMessageContaining("not delivered");
        ObjectNode hidden = output(1);
        ((ObjectNode) hidden.path("proposal_changes").get(0).path("proposal").path("instruction")).put("text", "매일 삼십 번 연습하세요.");
        assertThatThrownBy(() -> apply(apply(CoachingStateReducer.empty(), output(0), 0), hidden, 1))
                .hasMessageContaining("undisclosed");
    }
    @Test void acknowledgmentCannotProveSelectionOrExecution() {
        ObjectNode response = output(2);
        ((ObjectNode) response.path("attempt_changes").get(0).path("attempt")).put("attempt_id", "a2");
        ArrayNode sources = sources(2);
        sources.forEach(s -> { if (s.path("id").asText().equals("m2")) ((ObjectNode) s).put("text", "네"); });
        assertThatThrownBy(() -> CoachingStateReducer.apply(proposed(), response, sources, "m2", "c3", "p2", "a2", 120, 2, true))
                .hasMessageContaining("acknowledgment");
    }
    @Test void aChangedDirectionCannotSilentlyKeepTheOldPractice() {
        ObjectNode state = proposed();
        ObjectNode response = output(2);
        response.set("context_update", state.path("context").deepCopy());
        ((ObjectNode) response.path("context_update").path("direction")).put("text", "전혀 다른 방향");
        response.putArray("proposal_changes"); response.putArray("attempt_changes");
        assertThatThrownBy(() -> apply(state, response, 2)).hasMessageContaining("reconsidering");
    }
    @Test void rejectsStaleRevisionWithoutChangingPreviousState() {
        ObjectNode state = proposed(); ObjectNode copy = state.deepCopy();
        assertThatThrownBy(() -> apply(state, output(1), 1)).hasMessageContaining("stale");
        assertThat(state).isEqualTo(copy);
    }
}
