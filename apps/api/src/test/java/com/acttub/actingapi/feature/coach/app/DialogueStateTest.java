package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class DialogueStateTest {
    private CoachSessionSnapshot session() {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.resource("/coaching/record.json"), "", "", "", 8000, "그 외", "그 외", null,
                List.of(), "", null, "open", "",
                List.of(new CoachTurnSnapshot("ai", "상대가 어떻게 하길 바랐어요?")))
                .withCoachingState("three_layers_v1", 0, null, "open", "");
    }

    @Test void shortAnswerIsPassedWithItsQuestionAndWrongReplyLinkMustRegenerate() {
        AtomicInteger calls = new AtomicInteger();
        var engine = new CoachEngine((system, text) -> {
            JsonNode input = StructuredJson.parse(text);
            assertThat(input.path("last_exchange").path("coach_message").path("text").asText()).isEqualTo("상대가 어떻게 하길 바랐어요?");
            assertThat(input.path("last_exchange").path("actor_message").path("text").asText()).isEqualTo("ㅁㄹ");
            assertThat(input.path("coaching_state").has("proposals")).isFalse();
            ObjectNode response = StructuredCoachEngineTest.respond(input, "그 장면에서 상대는 떠나는 중인가요?", "continue");
            if (calls.getAndIncrement() == 0) ((ObjectNode) response.path("reply_link")).put("actor_quote", "떠나지 않았으면 좋겠어요");
            return StructuredCoachEngineTest.generated(response);
        }, new RecordingFailureReporter(), new RecordingLlmTelemetry());
        CoachResult result = engine.reply(session(), "ㅁㄹ", UUID.randomUUID());
        assertThat(calls).hasValue(2);
        assertThat(result.session().coachingState().path("context").path("direction").isNull()).isTrue();
        assertThat(result.session().coachingState().path("last_reply").path("actor_quote").asText()).isEqualTo("ㅁㄹ");
    }

    @Test void assignmentsAndVagueInterpretationsAreRejectedBeforeTheyReachTheActor() {
        for (String invalid : List.of("이 망설임을 남기고 싶었나요?", "시선을 유지해 보세요.",
                "한 번 찍어보고 알려주세요.", "**시선**을 바꿔보세요.")) {
            CoachResult result = new CoachEngine((system, input) -> StructuredCoachEngineTest.generated(
                    StructuredCoachEngineTest.respond(StructuredJson.parse(input), invalid, "continue")),
                    new RecordingFailureReporter(), new RecordingLlmTelemetry())
                    .reply(session(), "모르겠어", UUID.randomUUID());
            assertThat(result.reply().message()).doesNotContain(invalid);
            assertThat(result.session().coachingState().path("proposals")).isEmpty();
        }
    }

    @Test void finishHandoffCarriesLastActorCorrectionAndAllConversationWithoutHiddenTasks() {
        CoachResult result = new CoachEngine((system, input) -> StructuredCoachEngineTest.generated(
                StructuredCoachEngineTest.respond(StructuredJson.parse(input), "지금까지 이야기한 내용으로 정리할게요.", "finish")),
                new RecordingFailureReporter(), new RecordingLlmTelemetry())
                .reply(session(), "실제 경험은 아니야. 여기까지 정리해줘", UUID.randomUUID());
        JsonNode handoff = result.reply().handoff();
        StructuredJson.validate("coach_handoff_v2", handoff);
        assertThat(handoff.path("conversation")).hasSize(3);
        assertThat(handoff.path("conversation").get(1).path("text").asText()).contains("실제 경험은 아니야");
        assertThat(handoff.path("source_catalog").toString()).contains("실제 경험은 아니야");
        assertThat(handoff.has("coaching_state")).isFalse();
        assertThat(handoff.path("context").path("reading").isNull()).isTrue();
    }

    @Test void contextPreservesActorWordsAndRejectsAnInventedGoalEvenWithAnActorSourceId() {
        ObjectNode state = CoachingStateReducer.empty();
        ObjectNode actor = StructuredJson.MAPPER.createObjectNode().put("id", "m1").put("text", "상대가 떠나지 않았으면 좋겠어");
        ObjectNode input = StructuredJson.MAPPER.createObjectNode(); input.set("user_message", actor); input.set("coaching_state", state);
        ObjectNode response = StructuredCoachEngineTest.respond(input, "상대가 떠나지 않기를 바랐군요.", "continue");
        ObjectNode context = state.path("context").deepCopy();
        ObjectNode direction = context.putObject("direction").put("text", "상대가 떠나지 않았으면 좋겠어").put("origin", "actor_stated");
        direction.putArray("source_refs").add("m1"); response.set("context_update", context);
        var sources = StructuredJson.MAPPER.createArrayNode().add(CoachingStateReducer.source("m1", "actor_message", actor.path("text").asText()));
        ObjectNode next = DialogueState.apply(state, response, sources, actor, "c2", 120, 2, false, "");
        assertThat(next.path("context").path("direction").path("text")).isEqualTo(actor.path("text"));
        direction.put("text", "죄책감에 망설이는 모습을 표현하고 싶다");
        assertThatThrownBy(() -> DialogueState.apply(state, response, sources, actor, "c2", 120, 2, false, ""))
                .hasMessageContaining("actor's own words");
    }
}
