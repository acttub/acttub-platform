package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

/** 저장 전 상태 전이 검사: 모델이 낸 응답 중 규칙을 어기는 것은 어느 규칙인지 밝혀 거절하고, 지키는 것은 그대로 반영한다. */
class CoachingStateReducerRulesTest {
    JsonNode turn(int i) { return StructuredJson.resource("/coaching/turns.json").get(i).deepCopy(); }
    ObjectNode output(int i) { return (ObjectNode) turn(i).path("model_output"); }
    ArrayNode sources(int i) {
        JsonNode input = turn(i).path("input");
        ArrayNode sources = StructuredJson.MAPPER.createArrayNode();
        sources.addAll((ArrayNode) input.path("state_sources"));
        sources.addAll((ArrayNode) input.path("record_view").path("source_catalog"));
        return sources;
    }
    ObjectNode apply(JsonNode old, JsonNode output, int i) { return apply(old, output, i, i == 2); }
    ObjectNode apply(JsonNode old, JsonNode output, int i, boolean finish) {
        return apply(old, output, sources(i), i, finish);
    }
    ObjectNode apply(JsonNode old, JsonNode output, ArrayNode sources, int i, boolean finish) {
        JsonNode ids = turn(i).path("input").path("reserved_ids");
        return CoachingStateReducer.apply(old, output, sources, i == 0 ? null : "m" + i,
                ids.path("coach_message_id").asText(), ids.path("new_proposal_id").asText(),
                ids.path("new_attempt_id").asText(), 120, 2, finish);
    }
    ObjectNode first() { return apply(CoachingStateReducer.empty(), output(0), 0); }
    ObjectNode proposed() { return apply(first(), output(1), 1); }
    ObjectNode focus(ObjectNode response) { return (ObjectNode) response.path("context_update").path("focus"); }
    ObjectNode created(ObjectNode response) { return (ObjectNode) response.path("proposal_changes").get(0).path("proposal"); }
    ObjectNode attempt(ObjectNode response) { return (ObjectNode) response.path("attempt_changes").get(0).path("attempt"); }
    ObjectNode finishTurn() {
        ObjectNode response = output(2);
        attempt(response).put("attempt_id", "a2");
        return response;
    }
    void rejects(JsonNode old, ObjectNode response, int i, String message) {
        assertThatThrownBy(() -> apply(old, response, i)).isInstanceOf(IllegalArgumentException.class).hasMessage(message);
    }

    @Test void messageMustFitTheLengthQuestionAndDisplayRules() {
        assertThatThrownBy(() -> CoachingStateReducer.apply(CoachingStateReducer.empty(), output(0), sources(0), null,
                "c1", "p1", "a1", 10, 2, false)).hasMessage("message exceeds current length limit");
        rejects(CoachingStateReducer.empty(), output(0).put("message", "   "), 0, "message exceeds current length limit");
        rejects(CoachingStateReducer.empty(), output(0).put("message", "원한 느낌인가요? 다른 느낌인가요?"), 0, "at most one question");
        rejects(CoachingStateReducer.empty(), output(0).put("message", "```json 말끝이 길어요."), 0, "internal output in message");
        rejects(CoachingStateReducer.empty(), output(0).put("message", "source_refs 말끝이 길어요."), 0, "internal output in message");
    }

    @Test void aRequiredClosingMustFinishWithoutAQuestion() {
        assertThatThrownBy(() -> apply(CoachingStateReducer.empty(), output(0), 0, true)).hasMessage("must finish now");
        assertThatThrownBy(() -> apply(CoachingStateReducer.empty(), output(0).put("flow", "finish"), 0, true))
                .hasMessage("closing response must not ask a question");
    }

    @Test void directionStatedByTheActorCannotRestOnCoachText() {
        ObjectNode response = output(1);
        ((ObjectNode) response.path("context_update").path("direction")).putArray("source_refs").add("c1");
        rejects(first(), response, 1, "coach text cannot prove actor intent or execution");
    }

    @Test void aCoachProposedDirectionNeedsNoActorEvidence() {
        ObjectNode response = output(1);
        ((ObjectNode) response.path("context_update").path("direction")).put("origin", "coach_proposed").putArray("source_refs").add("c1");
        ObjectNode state = apply(first(), response, 1);
        assertThat(state.path("context").path("direction").path("origin").asText()).isEqualTo("coach_proposed");
        assertThat(state.path("active_proposal_id").asText()).isEqualTo("p1");
    }

    @Test void focusMustRestOnObservedMaterial() {
        ObjectNode limitation = output(0);
        focus(limitation).putArray("evidence_refs").add("l1");
        rejects(CoachingStateReducer.empty(), limitation, 0, "a limitation alone cannot establish a focus; retain or clear focus");
        ObjectNode coachText = output(0);
        focus(coachText).putArray("evidence_refs").add("e4").add("c1");
        rejects(CoachingStateReducer.empty(), coachText, 0, "focus must refer to observed material");
        ObjectNode notTranscript = output(0);
        focus(notTranscript).put("utterance_ref", "e4");
        rejects(CoachingStateReducer.empty(), notTranscript, 0, "focus utterance must be a transcript");
    }

    @Test void focusMayMixObservationWithLimitationAndNeedNoUtterance() {
        ObjectNode response = output(0);
        focus(response).putNull("utterance_ref").putArray("evidence_refs").add("e4").add("l2");
        ObjectNode state = apply(CoachingStateReducer.empty(), response, 0);
        assertThat(state.path("context").path("focus").path("evidence_refs").toString()).isEqualTo("[\"e4\",\"l2\"]");
        assertThat(state.path("source_catalog").findValuesAsText("id")).contains("e4", "l2").doesNotContain("u1");
    }

    @Test void aReadingBackedOnlyByThisCoachMessageIsRejected() {
        ObjectNode response = output(0);
        ((ObjectNode) response.path("context_update").path("reading")).putArray("source_refs").add("c1");
        rejects(CoachingStateReducer.empty(), response, 0, "unsupported interpretation");
    }

    @Test void aNewProposalMustUseTheReservedIdAndStartFresh() {
        ObjectNode wrongId = output(1);
        created(wrongId).put("proposal_id", "p9");
        rejects(first(), wrongId, 1, "invalid new proposal id");
        ObjectNode selected = output(1);
        created(selected).put("selection", "selected").putArray("selection_refs").add("m1");
        rejects(first(), selected, 1, "new proposal cannot invent history");
        ObjectNode retired = output(1);
        created(retired).put("lifecycle", "superseded");
        rejects(first(), retired, 1, "new proposal cannot invent history");
        ObjectNode history = output(1);
        created(history).putArray("retirement_refs").add("m1");
        rejects(first(), history, 1, "new proposal cannot invent history");
    }

    @Test void aNewInstructionMustCiteTheDisplayedMessageAndPriorEvidence() {
        ObjectNode uncited = output(1);
        ((ObjectNode) created(uncited).path("instruction")).putArray("source_refs").add("m1");
        rejects(first(), uncited, 1, "new instruction needs displayed message");
        ObjectNode onlyNow = output(1);
        created(onlyNow).putArray("basis_refs").add("c2");
        rejects(first(), onlyNow, 1, "practice needs prior evidence");
    }

    @Test void aKeepNoteIsHeldToTheSameDisclosureRule() {
        ObjectNode response = output(1);
        created(response).putObject("keep").put("text", "붙잡는 뜻은 남으면서").putArray("source_refs").add("c2");
        ObjectNode state = apply(first(), response, 1);
        assertThat(state.path("proposals").get(0).path("keep").path("text").asText()).isEqualTo("붙잡는 뜻은 남으면서");
        ObjectNode hidden = output(1);
        created(hidden).putObject("keep").put("text", "숨은 숙제").putArray("source_refs").add("c2");
        rejects(first(), hidden, 1, "undisclosed practice instruction");
    }

    @Test void changesMustNameAKnownProposalOnce() {
        ObjectNode unknown = finishTurn();
        ((ObjectNode) unknown.path("proposal_changes").get(0)).put("proposal_id", "p9");
        rejects(proposed(), unknown, 2, "unknown or repeated proposal change");
        ObjectNode twice = finishTurn();
        ((ArrayNode) twice.path("proposal_changes")).add(twice.path("proposal_changes").get(0).deepCopy());
        rejects(proposed(), twice, 2, "unknown or repeated proposal change");
    }

    @Test void declinedProposalNeedsTheActorsWordsAndClearsTheActivePractice() {
        ObjectNode response = output(2);
        ((ArrayNode) response.path("proposal_changes")).removeAll().addObject().put("kind", "retire").put("proposal_id", "p1")
                .put("reason", "declined").putArray("source_refs").add("m2");
        response.putArray("attempt_changes");
        response.put("message", "그 연습은 내려놓을게요. 다음에 다시 봐요.");
        ArrayNode sources = sources(2);
        sources.forEach(s -> { if (s.path("id").asText().equals("m2")) ((ObjectNode) s).put("text", "그건 안 할래. 다른 걸로 하자."); });
        ObjectNode state = apply(proposed(), response, sources, 2, true);
        assertThat(state.path("proposals").get(0).path("lifecycle").asText()).isEqualTo("declined");
        assertThat(state.path("proposals").get(0).path("retirement_refs").toString()).isEqualTo("[\"m2\"]");
        assertThat(state.path("active_proposal_id").isNull()).isTrue();

        ObjectNode coachOnly = response.deepCopy();
        ((ObjectNode) coachOnly.path("proposal_changes").get(0)).putArray("source_refs").add("m2").add("c2");
        assertThatThrownBy(() -> apply(proposed(), coachOnly, sources, 2, true))
                .hasMessage("coach text cannot prove actor intent or execution");
    }

    @Test void supersededProposalNeedsNoActorWordsButThenCannotChangeAgain() {
        ObjectNode retire = output(2);
        ((ArrayNode) retire.path("proposal_changes")).removeAll().addObject().put("kind", "retire").put("proposal_id", "p1")
                .put("reason", "superseded").putArray("source_refs").add("c2");
        retire.putArray("attempt_changes");
        retire.put("message", "그 연습은 접어 둘게요.");
        ObjectNode retired = apply(proposed(), retire, 2);
        assertThat(retired.path("proposals").get(0).path("lifecycle").asText()).isEqualTo("superseded");

        ObjectNode select = output(2);
        select.put("base_state_revision", 3);
        select.putArray("attempt_changes");
        assertThatThrownBy(() -> apply(retired, select, 2)).hasMessage("retired proposal is immutable");
    }

    @Test void onlyOneProposalMayStayActive() {
        ObjectNode second = output(1);
        second.put("base_state_revision", 2);
        created(second).put("proposal_id", "p2");
        ((ObjectNode) created(second).path("instruction")).putArray("source_refs").add("c3");
        ((ObjectNode) created(second).path("comparison")).putArray("source_refs").add("c3");
        ArrayNode sources = sources(2);
        assertThatThrownBy(() -> apply(proposed(), second, sources, 2, false)).hasMessage("only one active proposal");
    }

    @Test void practiceNeedsADirectionAndAFocus() {
        ObjectNode response = output(1);
        ((ObjectNode) response.path("context_update")).putNull("direction");
        rejects(first(), response, 1, "practice needs direction and focus");
    }

    @Test void changingFocusKeepsAPracticeOnlyWhenItIsNew() {
        ObjectNode response = output(1);
        focus(response).put("label", "“가지 마”의 말끝 길이");
        ObjectNode state = apply(first(), response, 1);
        assertThat(state.path("context").path("focus").path("label").asText()).isEqualTo("“가지 마”의 말끝 길이");
        assertThat(state.path("active_proposal_id").asText()).isEqualTo("p1");
    }

    @Test void attemptsMustUseTheReservedIdAndAKnownUnchangedProposal() {
        ObjectNode badId = output(2);
        attempt(badId).put("attempt_id", "a9");
        rejects(proposed(), badId, 2, "invalid attempt id");
        ObjectNode unknown = finishTurn();
        attempt(unknown).put("proposal_id", "p9");
        rejects(proposed(), unknown, 2, "unknown attempt proposal");
        ObjectNode changed = finishTurn();
        ((ObjectNode) attempt(changed).path("instruction")).put("text", "다른 지시");
        rejects(proposed(), changed, 2, "attempt instruction changed");
        ObjectNode earlier = finishTurn();
        attempt(earlier).putArray("execution_refs").add("m1");
        rejects(proposed(), earlier, 2, "change needs the current actor message");
        ObjectNode coach = finishTurn();
        attempt(coach).putArray("execution_refs").add("m2").add("c2");
        rejects(proposed(), coach, 2, "coach text cannot prove actor intent or execution");
    }

    @Test void anUnknownExecutionNeedsNoActorEvidence() {
        ObjectNode response = finishTurn();
        attempt(response).put("execution", "unknown").putArray("execution_refs");
        ObjectNode state = apply(proposed(), response, 2);
        assertThat(state.path("attempts").get(0).path("execution").asText()).isEqualTo("unknown");
        assertThat(state.path("attempts").get(0).path("attempt_id").asText()).isEqualTo("a2");
    }

    ObjectNode triedState() {
        ObjectNode response = finishTurn();
        attempt(response).put("execution", "reported_tried").putObject("result").put("direction", "closer").put("basis", "actor_report")
                .putObject("statement").put("text", "짧게 끝내니 덜 애원하는 느낌").putArray("source_refs").add("m2");
        return apply(proposed(), response, 2, false);
    }

    @Test void aReportedResultIsKeptWithTheActorsWords() {
        ObjectNode state = triedState();
        JsonNode saved = state.path("attempts").get(0);
        assertThat(saved.path("execution").asText()).isEqualTo("reported_tried");
        assertThat(saved.path("result").path("direction").asText()).isEqualTo("closer");
        assertThat(saved.path("result").path("statement").path("text").asText()).isEqualTo("짧게 끝내니 덜 애원하는 느낌");
    }

    @Test void aResultMustQuoteTheActor() {
        ObjectNode response = finishTurn();
        attempt(response).put("execution", "reported_tried").putObject("result").put("direction", "closer").put("basis", "actor_report")
                .putObject("statement").put("text", "짧게 끝냈다").putArray("source_refs").add("m2").add("c2");
        rejects(proposed(), response, 2, "coach text cannot prove actor intent or execution");
    }

    ObjectNode laterAttempt(String execution, String proposal) {
        ObjectNode response = output(2);
        response.put("base_state_revision", 3);
        response.putArray("proposal_changes");
        attempt(response).put("attempt_id", "a2").put("proposal_id", proposal).put("execution", execution);
        if ("unknown".equals(execution)) attempt(response).putArray("execution_refs");
        return response;
    }

    @Test void anExistingAttemptCannotMoveOrForgetThatItWasTried() {
        ObjectNode tried = triedState();
        assertThatThrownBy(() -> apply(tried, laterAttempt("not_tried", "p1"), 2, false))
                .hasMessage("cannot erase execution history");
        ObjectNode updated = apply(tried, laterAttempt("reported_tried", "p1"), 2, false);
        assertThat(updated.path("attempts")).hasSize(1);
        assertThat(updated.path("attempts").get(0).path("result").isNull()).isTrue();
        assertThat(updated.path("revision").asInt()).isEqualTo(4);
    }

    @Test void aNotTriedAttemptMayLaterBeReportedTried() {
        ObjectNode notTried = apply(proposed(), finishTurn(), 2, false);
        ObjectNode updated = apply(notTried, laterAttempt("reported_tried", "p1"), 2, false);
        assertThat(updated.path("attempts").get(0).path("execution").asText()).isEqualTo("reported_tried");
    }

    @Test void styleUpdateIsSaved() {
        ObjectNode state = apply(CoachingStateReducer.empty(), output(0).put("style_update", "brief"), 0);
        assertThat(state.path("response_style").asText()).isEqualTo("brief");
    }
}
