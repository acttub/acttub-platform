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
    @Test void anExactExperienceQuoteIsStillNotAGoal() {
        ObjectNode state = CoachingStateReducer.empty();
        String text = "상대에게 말을 건네는 느낌이 편했어.";
        ObjectNode actor = StructuredJson.MAPPER.createObjectNode().put("id", "m1").put("text", text);
        ObjectNode input = StructuredJson.MAPPER.createObjectNode();
        input.set("user_message", actor); input.set("coaching_state", state);
        ObjectNode response = StructuredCoachEngineTest.respond(input, "편하게 느끼셨군요.", "continue");
        ObjectNode context = state.path("context").deepCopy();
        context.putObject("direction").put("text", text).put("origin", "actor_stated").putArray("source_refs").add("m1");
        response.set("context_update", context);
        var sources = StructuredJson.MAPPER.createArrayNode().add(CoachingStateReducer.source("m1", "actor_message", text));
        assertThatThrownBy(() -> DialogueState.apply(state, response, sources, actor, "c1", 120, 2, false, ""))
                .hasMessageContaining("경험만 말한 발화");
        context.putNull("direction");
        assertThat(DialogueState.apply(state, response, sources, actor, "c1", 120, 2, false, "")
                .path("context").path("direction").isNull()).isTrue();
    }

    @Test void separatesReportedExperienceFromObservedSpeech() {
        for (String invalid : List.of("그 편안함이 영상에서 보여요.",
                "편하게 상대에게 말을 건네는 감각이 세 문장 모두에서 마지막 음절까지 또렷하게 이어졌어요.",
                "그 감각이 화면에 드러나요.", "상대에게 말을 건네는 감각이 세 문장 모두 또렷하게 전달됐어요.")) {
            assertThat(DialogueState.presentsExperienceAsObservation(invalid)).as(invalid).isTrue();
        }
        for (String valid : List.of("편하게 느끼셨군요. 영상에서는 끝말까지 들렸어요.",
                "그 감각을 유지하고 싶나요?", "영상만으로 편안함을 확인할 수는 없어요.")) {
            assertThat(DialogueState.presentsExperienceAsObservation(valid)).as(valid).isFalse();
        }
    }
    @Test void detectsScopeResetParaphrasesWithoutRejectingQuotedLinesOrUsefulQuestions() {
        for (String message : List.of("세 문장 중 어느 끝말을 가장 분명히 남기고 싶나요?",
                "어떤 문장부터 볼까요?", "어느 대사가 가장 중요해요？", "대사 하나를 골라주세요.",
                "가장 바꾸고 싶은 구간은 어떤 부분인가요?")) {
            assertThat(DialogueState.asksToSelectPassage(message)).as(message).isTrue();
        }
        for (String message : List.of("마지막 문장 하나에서만 소리가 작아져요.",
                "“어느 대사가 중요해?”라는 말 뒤에 소리가 작아져요. 이 설명이 어려웠나요?",
                "끝말을 들리게 하는 것과 크게 말하는 게 같다고 느껴지나요?",
                "마지막 문장은 작게 전달하려던 건가요?")) {
            assertThat(DialogueState.asksToSelectPassage(message)).as(message).isFalse();
        }
    }

    @Test void wholeVideoSelectionQuestionRegeneratesBeforeItIsSavedOrShown() {
        AtomicInteger replies = new AtomicInteger();
        var engine = new CoachEngine((system, text) -> {
            JsonNode input = StructuredJson.parse(text);
            if (input.path("user_message").isNull()) {
                ObjectNode response = StructuredCoachEngineTest.respond(input, "몸통의 위치가 영상 전체에서 유지돼요. 이 부분이 궁금했나요?", "continue");
                ObjectNode focus = (ObjectNode) response.path("context_update").path("focus");
                focus.put("scope", "whole_video").put("pattern", "recurring");
                focus.putArray("evidence_refs").add("e8");
                ((ObjectNode) response.path("reply_link")).putArray("evidence_refs").add("e8");
                return StructuredCoachEngineTest.generated(response);
            }
            boolean first = replies.getAndIncrement() == 0;
            if (!first) assertThat(input.path("validation_error").asText()).contains("전체 초점");
            return StructuredCoachEngineTest.generated(StructuredCoachEngineTest.respond(input,
                    first ? "어떤 문장부터 볼까요?" : "영상 전체에서 몸통 위치가 유지된다는 뜻이에요.", "continue"));
        }, new RecordingFailureReporter(), new RecordingLlmTelemetry());
        var opening = engine.start(session(), UUID.randomUUID());
        var result = engine.reply(opening.session(), "전체 흐름이 궁금해", UUID.randomUUID());
        assertThat(replies).hasValue(2);
        assertThat(result.reply().message()).isEqualTo("영상 전체에서 몸통 위치가 유지된다는 뜻이에요.");
        assertThat(result.session().turns().toString()).doesNotContain("어떤 문장부터");
        assertThat(result.session().status()).isEqualTo("open");
    }

    @Test void localDialogueCanClarifyWhichPassageTheActorMeans() {
        AtomicInteger calls = new AtomicInteger();
        var engine = new CoachEngine((system, text) -> {
            calls.incrementAndGet();
            return StructuredCoachEngineTest.generated(StructuredCoachEngineTest.respond(
                    StructuredJson.parse(text), "어떤 문장을 말한 건가요?", "continue"));
        }, new RecordingFailureReporter(), new RecordingLlmTelemetry());
        var result = engine.reply(session(), "그 대사만 보고 싶어", UUID.randomUUID());
        assertThat(calls).hasValue(1);
        assertThat(result.reply().message()).isEqualTo("어떤 문장을 말한 건가요?");
    }

    @Test void exhaustedGenerationDoesNotCreateAnErrorTurnOrConsumeTheDialogueBudget() {
        AtomicInteger calls = new AtomicInteger();
        var engine = new CoachEngine((system, text) -> {
            calls.incrementAndGet();
            throw new IllegalStateException("synthetic provider failure");
        }, new RecordingFailureReporter(), new RecordingLlmTelemetry());
        var before = session();
        var turns = List.copyOf(before.turns());
        assertThatThrownBy(() -> engine.reply(before, "상대가 나가려고 해서", UUID.randomUUID()))
                .isInstanceOf(CoachReplyUnavailable.class);
        assertThat(calls).hasValue(4);
        assertThat(before.turns()).isEqualTo(turns);
        assertThat(before.stateRevision()).isZero();
        assertThat(before.status()).isEqualTo("open");
    }

    @Test void retriesKeepEveryPriorConstraintInsteadOfOscillatingBetweenErrors() {
        AtomicInteger calls = new AtomicInteger();
        var engine = new CoachEngine((system, text) -> {
            var input = StructuredJson.parse(text);
            int call = calls.getAndIncrement();
            if (call == 0) throw new IllegalArgumentException("first synthetic constraint");
            assertThat(input.path("validation_errors").toString()).contains("first synthetic constraint");
            if (call == 1) throw new IllegalArgumentException("second synthetic constraint");
            assertThat(input.path("validation_errors").toString()).contains("second synthetic constraint");
            return StructuredCoachEngineTest.generated(StructuredCoachEngineTest.respond(input, "상대가 나가려는 상황을 알려주셨군요.", "continue"));
        }, new RecordingFailureReporter(), new RecordingLlmTelemetry());
        assertThat(engine.reply(session(), "상대가 나가려고 해서", UUID.randomUUID()).session().status()).isEqualTo("open");
        assertThat(calls).hasValue(3);
    }

    @Test void knownMissingHandEvidenceIsExplainedWithoutAskingTheModelToInferOtherBodyParts() {
        var engine = new CoachEngine((system, text) -> { throw new AssertionError("No model call is needed for a known observation limit"); },
                new RecordingFailureReporter(), new RecordingLlmTelemetry());
        var result = engine.reply(session(), "내 손으로 붙잡는 연기는 영상에서 잘 전달됐어?", UUID.randomUUID());
        assertThat(result.reply().message()).contains("손", "확인할 수 없어").doesNotContain("눈썹", "목소리", "몸통");
        assertThat(result.session().coachingState().path("last_reply").path("move").asText()).isEqualTo("explain");
        assertThat(result.session().status()).isEqualTo("open");
    }
    @Test void aShortAcknowledgementCanPrecedeTwoUsefulFollowupSentences() {
        var engine = new CoachEngine((system, text) -> StructuredCoachEngineTest.generated(StructuredCoachEngineTest.respond(
                StructuredJson.parse(text), "알겠습니다. 지갑을 돌려받으려는 말이군요. 그 요구를 상대에게 분명히 건네세요.", "continue")),
                new RecordingFailureReporter(), new RecordingLlmTelemetry());
        assertThat(engine.reply(session(), "지갑을 돌려받으려는 거예요", UUID.randomUUID()).reply().message()).startsWith("알겠습니다.");
    }

    @Test void aBareCorrectionAfterACoachInterpretationClarifiesTheTargetBeforeChangingContext() {
        var engine = new CoachEngine((system, text) -> { throw new AssertionError("Do not guess the target of a bare correction"); },
                new RecordingFailureReporter(), new RecordingLlmTelemetry());
        var before = session().withTurns(List.of(new CoachTurnSnapshot("ai", "상대를 붙잡으려는 말일 수 있어요.")));
        var result = engine.reply(before, "내가 실수로 말했어", UUID.randomUUID());
        assertThat(result.reply().message()).contains("저에게 한 답", "영상 속 대사");
        assertThat(result.session().coachingState().path("last_reply").path("move").asText()).isEqualTo("clarify");
        assertThat(result.session().coachingState().path("context").path("scene_context").path("situation").isNull()).isTrue();
    }

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
        for (String invalid : List.of("이 망설임을 남기고 싶었나요?", "시선을 유지해 보고 알려주세요.",
                "한 번 찍어보고 알려주세요.", "**시선**을 바꿔보세요.", "그 편안함이 영상에서 보여요.")) {
            assertThatThrownBy(() -> new CoachEngine((system, input) -> StructuredCoachEngineTest.generated(
                    StructuredCoachEngineTest.respond(StructuredJson.parse(input), invalid, "continue")),
                    new RecordingFailureReporter(), new RecordingLlmTelemetry())
                    .reply(session(), "모르겠어", UUID.randomUUID()))
                    .isInstanceOf(CoachReplyUnavailable.class);
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
