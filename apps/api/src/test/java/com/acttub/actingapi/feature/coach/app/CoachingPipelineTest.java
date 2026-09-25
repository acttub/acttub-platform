package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.GenerationOptions;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

class CoachingPipelineTest {
    static CoachSessionSnapshot session() {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.resource("/coaching/record.json"), "", "", "", 8000, "그 외", "그 외", null,
                List.of(), "", null, "open", "", List.of()).withCoachingState("three_layers_v1", 0, null, "open", "");
    }
    static ObjectNode draft(JsonNode input, String message) {
        ObjectNode legacy = StructuredCoachEngineTest.respond(input, message, "continue");
        ObjectNode result = StructuredJson.MAPPER.createObjectNode().put("message", message);
        result.set("context_update", legacy.path("context_update"));
        result.set("evidence_refs", legacy.path("reply_link").path("evidence_refs"));
        return result;
    }
    static GeneratedText out(JsonNode value) { return new GeneratedText(value.toString(), null, "test"); }
    static CoachEngine engine(TextGenerator generator) {
        return new CoachEngine(generator, new RecordingFailureReporter(), new RecordingLlmTelemetry(), true);
    }

    @ParameterizedTest @EnumSource(CoachingRoute.class)
    void codeDispatchesExactlyOneRouteAndPersistsGeneratedReply(CoachingRoute route) {
        List<String> stages = new ArrayList<>();
        TextGenerator model = new TextGenerator() {
            public GeneratedText generate(String p, String i) { throw new AssertionError("bounded options required"); }
            public GeneratedText generate(String prompt, String text, GenerationOptions options) {
                JsonNode input = StructuredJson.parse(text);
                if ("coaching_route".equals(options.schemaName())) {
                    stages.add("classify");
                    assertThat(options.model()).isEqualTo("gpt-5.6-luna");
                    assertThat(options.schema().path("properties").path("route").path("enum"))
                            .extracting(JsonNode::asText).containsExactly("advance", "scaffold", "repair", "respond");
                    assertThat(input.path("coaching_state").path("revision").asLong()).isZero();
                    assertThat(input.path("last_exchange").path("coach_message").path("text").asText())
                            .isEqualTo("어떤 뜻으로 말했어요?");
                    assertThat(input.path("video_record").path("events")).isNotEmpty();
                    assertThat(input.path("conversation_history").get(0).path("text").asText()).isEqualTo("어떤 뜻으로 말했어요?");
                    assertThat(input.path("user_message").path("text").asText()).isEqualTo("떠나지 말라는 뜻이에요");
                    return out(StructuredJson.MAPPER.createObjectNode().put("route", route.id));
                }
                stages.add("generate");
                assertThat(prompt).isEqualTo(CoachingPipeline.prompt(route, false));
                assertThat(prompt).doesNotContain(StructuredJson.textResource("/coaching/routes/opening.txt"));
                assertThat(prompt).doesNotContain("route 하나", "unobservable_hand_requested", "dialogue_progress");
                for (CoachingRoute other : CoachingRoute.values()) {
                    if (other != route) assertThat(prompt).doesNotContain(StructuredJson.textResource("/coaching/routes/" + other.id + ".txt"));
                }
                assertThat(input.has("dialogue_progress")).isFalse();
                return out(draft(input, "상대를 붙잡으려는 말인 것이군요."));
            }
        };
        CoachResult result = engine(model).reply(session().withTurns(List.of(new CoachTurnSnapshot("ai", "어떤 뜻으로 말했어요?"))),
                "떠나지 말라는 뜻이에요", UUID.randomUUID());
        assertThat(stages).containsExactly("classify", "generate");
        assertThat(result.reply().message()).isEqualTo("상대를 붙잡으려는 말인 것이군요.");
        assertThat(result.session().turns().getLast().text()).isEqualTo(result.reply().message());
        assertThat(result.session().stateRevision()).isEqualTo(1);
    }

    @Test void videoOnlyOpeningDoesNotInventAnActorTurn() {
        AtomicInteger calls = new AtomicInteger();
        CoachResult result = engine((prompt, text) -> {
            JsonNode input = StructuredJson.parse(text);
            int stage = calls.getAndIncrement();
            if (stage == 0) {
                assertThat(input.path("user_message").isNull()).isTrue();
                return out(StructuredJson.MAPPER.createObjectNode().put("route", "respond"));
            }
            if (stage == 1) {
                assertThat(prompt).contains(StructuredJson.textResource("/coaching/routes/opening.txt"));
                assertThat(prompt).doesNotContain(StructuredJson.textResource("/coaching/routes/respond.txt"));
                return out(draft(input, "이 장면에서 상대가 남아 있어야 하는 이유는 무엇인가요?"));
            }
            throw new AssertionError("unexpected extra model call");
        }).start(session(), UUID.randomUUID());
        assertThat(calls).hasValue(2);
        assertThat(result.session().turns()).hasSize(1);
        assertThat(result.session().turns().getFirst().role()).isEqualTo("ai");
        assertThat(result.session().coachingState().path("context").path("focus").isObject()).isTrue();
    }

    @Test void openingRegenerationKeepsTheOpeningTaskWithoutReclassifying() {
        AtomicInteger calls = new AtomicInteger();
        String message = "왜 “지금은 아니에요. 나중이라고요.”로 말이 바뀌나요? 상대에게 원하는 것을 말해 주세요.";
        var result = engine((prompt, text) -> {
            JsonNode input = StructuredJson.parse(text);
            int stage = calls.getAndIncrement();
            if (stage == 0) return out(StructuredJson.MAPPER.createObjectNode().put("route", "respond"));
            assertThat(prompt).contains(StructuredJson.textResource("/coaching/routes/opening.txt"));
            assertThat(prompt).doesNotContain(StructuredJson.textResource("/coaching/routes/respond.txt"));
            ObjectNode response = draft(input, message);
            if (stage == 1) response.putArray("evidence_refs").add("missing-source");
            else {
                assertThat(stage).isEqualTo(2);
                assertThat(input.path("validation_errors")).isNotEmpty();
            }
            return out(response);
        }).start(session(), UUID.randomUUID());
        assertThat(calls).hasValue(3);
        assertThat(result.session().turns()).hasSize(1);
        assertThat(result.reply().message()).isEqualTo(message);
    }

    @ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(strings = {"invented_route", "understand_scene", "assess_performance", "design_performance", "adjust_performance"})
    void unknownRouteFailsWithoutGeneratingOrSavingAnInventedReply(String invalidRoute) {
        AtomicInteger calls = new AtomicInteger();
        var original = session();
        assertThatThrownBy(() -> engine((p, t) -> {
            calls.incrementAndGet();
            return out(StructuredJson.MAPPER.createObjectNode().put("route", invalidRoute));
        }).reply(original, "질문이에요", UUID.randomUUID())).isInstanceOf(CoachReplyUnavailable.class);
        assertThat(calls).hasValue(1);
        assertThat(original.turns()).isEmpty();
    }

    @Test void missingVideoCannotStartEvenWithAValidClassifier() {
        var source = session();
        ObjectNode failed = source.observationPack().deepCopy();
        ((ObjectNode) failed.path("processing")).putArray("processed_ranges");
        var noVideo = new CoachSessionSnapshot(source.sessionId(), source.practiceSessionId(), source.summaryId(), source.userId(),
                failed, "", "", "", 8000, "그 외", "그 외", null, List.of(), "", null, "open", "", List.of())
                .withCoachingState("three_layers_v1", 0, null, "open", "");
        assertThatThrownBy(() -> engine((p,t) -> { throw new AssertionError("must not call model"); })
                .start(noVideo, UUID.randomUUID())).isInstanceOf(CoachReplyUnavailable.class);
    }

    @Test void validGenerationDoesNotCallAnEditor() {
        AtomicInteger calls = new AtomicInteger();
        var result = engine((p,t) -> switch (calls.getAndIncrement()) {
            case 0 -> out(StructuredJson.MAPPER.createObjectNode().put("route", "respond"));
            case 1 -> out(draft(StructuredJson.parse(t), "상대에게 나가지 말아야 할 이유를 건네보세요."));
            default -> throw new AssertionError("only classification and generation may run");
        }).reply(session(), "어떻게 해야 해요?", UUID.randomUUID());
        assertThat(calls).hasValue(2);
        assertThat(result.reply().message()).isEqualTo("상대에게 나가지 말아야 할 이유를 건네보세요.");
    }

    @Test void closingSkipsClassifierAndPreservesHandoffContract() {
        AtomicInteger calls = new AtomicInteger();
        CoachResult result = engine((p,t) -> {
            JsonNode input = StructuredJson.parse(t);
            if (calls.getAndIncrement() == 0) {
                assertThat(p).contains("대화를 마무리한다").doesNotContain("route 하나");
                ObjectNode draft = draft(input, "지금까지 나눈 이야기로 정리할게요.");
                draft.putNull("context_update");
                return out(draft);
            }
            throw new AssertionError("unexpected extra model call");
        }).reply(session(), "그만할게요", UUID.randomUUID());
        assertThat(calls).hasValue(1);
        assertThat(result.reply().status()).isEqualTo("complete");
        StructuredJson.validate("coach_handoff_v2", result.reply().handoff());
        assertThat(result.reply().handoff().path("conversation").get(1).path("text").asText()).isEqualTo(result.reply().message());
    }

    @Test void invalidEvidenceIsRetriedWithinTheSelectedRouteOnly() {
        AtomicInteger calls = new AtomicInteger();
        CoachResult result = engine((p,t) -> {
            JsonNode input = StructuredJson.parse(t);
            return switch (calls.getAndIncrement()) {
                case 0 -> out(StructuredJson.MAPPER.createObjectNode().put("route", "respond"));
                case 1 -> {
                    ObjectNode draft = draft(input, "말이 이어지고 있어요.");
                    draft.putArray("evidence_refs").add("invented-source");
                    yield out(draft);
                }
                case 2 -> {
                    assertThat(input.path("validation_errors")).isNotEmpty();
                    yield out(draft(input, "말이 이어지고 있어요."));
                }
                default -> throw new AssertionError("unexpected extra model call");
            };
        }).reply(session(), "어떻게 보여요?", UUID.randomUUID());
        assertThat(calls).hasValue(3);
        assertThat(result.reply().message()).isEqualTo("말이 이어지고 있어요.");
    }

    @Test void longActorMessageIsNotTruncatedForModelsAndKeepsAValidStorageExcerpt() {
        String actor = "상대를 붙잡으려는 이유를 이야기하고 있어요. ".repeat(20) + "마지막에는 열쇠도 돌려받고 싶어요.";
        AtomicInteger calls = new AtomicInteger();
        var result = engine((p,t) -> {
            JsonNode input = StructuredJson.parse(t);
            int stage = calls.getAndIncrement();
            if (stage < 2) assertThat(input.path("user_message").path("text").asText()).isEqualTo(actor);
            if (stage == 0) return out(StructuredJson.MAPPER.createObjectNode().put("route", "advance"));
            if (stage == 1) return out(draft(input, "붙잡는 이유와 열쇠를 돌려받으려는 목적을 함께 이야기했네요."));
            throw new AssertionError("unexpected extra model call");
        }).reply(session(), actor, UUID.randomUUID());
        assertThat(calls).hasValue(2);
        assertThat(result.session().turns().getFirst().text()).isEqualTo(actor);
        assertThat(result.session().coachingState().path("last_reply").path("actor_quote").asText()).hasSize(100);
    }

    @Test void springUsesRoutedPipelineByDefault() {
        AtomicInteger calls = new AtomicInteger();
        TextGenerator generator = (p,t) -> {
            JsonNode input = StructuredJson.parse(t);
            return switch (calls.getAndIncrement()) {
                case 0 -> out(StructuredJson.MAPPER.createObjectNode().put("route", "advance"));
                case 1 -> out(draft(input, "상대를 붙잡으려는 이야기군요."));
                default -> throw new AssertionError("unexpected extra model call");
            };
        };
        new org.springframework.boot.test.context.runner.ApplicationContextRunner()
                .withUserConfiguration(CoachEngine.class)
                .withBean(TextGenerator.class, () -> generator)
                .withBean(com.acttub.actingapi.platform.observability.FailureReporter.class, RecordingFailureReporter::new)
                .withBean(com.acttub.actingapi.platform.observability.LlmTelemetry.class, RecordingLlmTelemetry::new)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context.getBean(CoachEngine.class).reply(session(), "이유를 알고 싶어요", UUID.randomUUID()).reply().status())
                            .isEqualTo("continue");
                });
        assertThat(calls).hasValue(2);
    }

    @Test void correctedContextReachesTheNextClassifierGeneratorAndHandoff() {
        String original = "용서받고 싶어요";
        String correction = "아니요, 상대가 알고 있는지 떠보려는 거예요";
        String repairedMessage = "용서를 구한다는 전제를 고칠게요. 상대의 반응에서 알고 있다는 신호를 확인하려는 거군요.";
        AtomicInteger calls = new AtomicInteger();
        var coach = engine((prompt, text) -> {
            JsonNode input = StructuredJson.parse(text);
            int call = calls.getAndIncrement();
            if (call == 0 || call == 2 || call == 4) {
                if (call == 2) {
                    assertThat(input.path("coaching_state").path("context").path("scene_context")
                            .path("character_goal").path("text").asText()).isEqualTo(original);
                    assertThat(input.path("user_message").path("text").asText()).isEqualTo(correction);
                }
                if (call == 4) {
                    assertThat(input.path("coaching_state").path("context").path("scene_context")
                            .path("character_goal").path("text").asText()).isEqualTo(correction);
                    assertThat(input.path("last_exchange").path("coach_message").path("text").asText()).isEqualTo(repairedMessage);
                    assertThat(input.path("conversation_history")).hasSize(4);
                }
                return out(StructuredJson.MAPPER.createObjectNode().put("route", call == 2 ? "repair" : "advance"));
            }
            if (call == 1 || call == 3) {
                assertThat(prompt).isEqualTo(CoachingPipeline.prompt(call == 3 ? CoachingRoute.REPAIR : CoachingRoute.ADVANCE, false));
                ObjectNode result = draft(input, call == 3 ? repairedMessage : "잘못을 이해받고 싶다는 뜻이군요.");
                ObjectNode context = input.path("coaching_state").path("context").deepCopy();
                ObjectNode goal = ((ObjectNode) context.path("scene_context")).putObject("character_goal");
                goal.put("text", input.path("user_message").path("text").asText()).put("origin", "actor_stated");
                goal.putArray("source_refs").add(input.path("user_message").path("id").asText());
                result.set("context_update", context);
                return out(result);
            }
            if (call == 5 || call == 6) {
                assertThat(input.path("coaching_state").path("context").path("scene_context")
                        .path("character_goal").path("text").asText()).isEqualTo(correction);
                return out(draft(input, call == 6 ? "떠보려는 해석을 바탕으로 나눈 내용을 정리할게요." : "상대의 어떤 반응이 알고 있다는 신호가 될까요?"));
            }
            throw new AssertionError("unexpected extra model call");
        });
        var first = coach.reply(session(), original, UUID.randomUUID());
        var repaired = coach.reply(first.session(), correction, UUID.randomUUID());
        var next = coach.reply(repaired.session(), "네, 떠보는 거예요", UUID.randomUUID());
        var closed = coach.reply(next.session(), "그만할게요", UUID.randomUUID());
        assertThat(calls).hasValue(7);
        assertThat(closed.reply().handoff().path("context").path("scene_context").path("character_goal")
                .path("text").asText()).isEqualTo(correction);
        assertThat(closed.reply().handoff().path("conversation").get(3).path("text").asText()).isEqualTo(repairedMessage);
    }

    @Test void classificationFailureDoesNotGenerateOrSaveATurn() {
        AtomicInteger calls = new AtomicInteger();
        var original = session();
        assertThatThrownBy(() -> engine((prompt, text) -> {
            calls.incrementAndGet();
            throw new IllegalStateException("classifier unavailable");
        }).reply(original, "뭔 말이에요?", UUID.randomUUID())).isInstanceOf(CoachReplyUnavailable.class);
        assertThat(calls).hasValue(1);
        assertThat(original.turns()).isEmpty();
    }

    @Test void invalidGenerationStopsAfterOneRetryWithoutSavingATurn() {
        AtomicInteger calls = new AtomicInteger();
        var original = session();
        assertThatThrownBy(() -> engine((prompt, text) -> {
            if (calls.getAndIncrement() == 0) return out(StructuredJson.MAPPER.createObjectNode().put("route", "repair"));
            ObjectNode result = draft(StructuredJson.parse(text), "잘못 이해한 내용을 고칠게요.");
            result.putArray("evidence_refs").add("nonexistent-evidence");
            return out(result);
        }).reply(original, "아닌데요", UUID.randomUUID())).isInstanceOf(CoachReplyUnavailable.class);
        assertThat(calls).hasValue(3);
        assertThat(original.turns()).isEmpty();
    }
}
