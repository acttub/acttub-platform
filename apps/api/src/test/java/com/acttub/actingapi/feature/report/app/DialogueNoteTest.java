package com.acttub.actingapi.feature.report.app;

import static org.assertj.core.api.Assertions.*;

import java.util.ArrayList;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class DialogueNoteTest {
    @Test void aFollowupQuestionDoesNotEraseTheCurrentDirectionFromTheSummary() {
        ObjectNode source = handoff();
        ((com.fasterxml.jackson.databind.node.ArrayNode) source.path("conversation")).addObject()
                .put("id", "question").put("role", "actor").put("text", "그래서 어떻게 하면 돼?");
        ObjectNode note = PracticeNote.assemble(source, text -> output().toString());
        assertThat(PracticeNote.publicView(note).path("summary").asText()).contains("애원하는 것처럼 보이긴 싫어");
        assertThat(note.path("practice").isObject()).isTrue();
    }

    @Test void experienceSurvivesInSummaryWithoutInventingAGoalOrExercise() {
        ObjectNode source = handoff();
        ((ObjectNode) source.path("context")).putNull("direction");
        var conversation = source.putArray("conversation");
        conversation.addObject().put("id", "experience").put("role", "actor").put("text", "상대에게 말을 건네는 느낌이 편했어.");
        conversation.addObject().put("id", "close").put("role", "actor").put("text", "여기까지 정리해줘");
        ((com.fasterxml.jackson.databind.node.ArrayNode) source.path("source_catalog")).addObject()
                .put("id", "experience").put("kind", "actor_message").put("text", "상대에게 말을 건네는 느낌이 편했어.")
                .putNull("record_id").putNull("record_version").putNull("start_ms").putNull("end_ms");
        ObjectNode generated = output();
        generated.putNull("next_take");
        generated.putArray("summary").addObject().put("source_ref", "experience").put("quote", "상대에게 말을 건네는 느낌이 편했어.");
        ObjectNode note = PracticeNote.assemble(source, text -> {
            assertThat(StructuredJson.parse(text).path("controls").path("can_propose").asBoolean()).isFalse();
            return generated.toString();
        });
        assertThat(PracticeNote.publicView(note).path("summary").asText()).contains("편했어", "라고 했어요");
        assertThat(note.path("direction").isNull()).isTrue();
        assertThat(note.path("practice").isNull()).isTrue();

        ObjectNode omitted = generated.deepCopy();
        omitted.putArray("summary");
        assertThat(PracticeNote.publicView(PracticeNote.assemble(source, text -> omitted.toString()))
                .path("summary").asText()).contains("편했어");
        assertThat(PracticeNote.publicView(PracticeNote.assemble(source, text -> { throw new IllegalStateException("offline"); }))
                .path("summary").asText()).contains("편했어");

        conversation.insertObject(1).put("id", "correction").put("role", "actor").put("text", "아니, 편했던 건 아니야.");
        var errors = new ArrayList<RuntimeException>();
        ObjectNode corrected = PracticeNote.assemble(source, text -> generated.toString(), errors::add);
        assertThat(errors).hasSize(2);
        assertThat(PracticeNote.publicView(corrected).path("summary").asText()).doesNotContain("편했어");
    }

    private ObjectNode handoff() {
        ObjectNode old = (ObjectNode) StructuredJson.resource("/coaching/handoff.json").deepCopy();
        ObjectNode next = old.deepCopy();
        next.put("schema_version", "acttub.coach_handoff.v2");
        ObjectNode context = old.path("coaching_state").path("context").deepCopy();
        context.putNull("reading");
        next.set("context", context);
        next.remove("coaching_state");
        next.putArray("conversation").addObject().put("id", "m1").put("role", "actor")
                .put("text", "붙잡고는 싶은데 애원하는 것처럼 보이긴 싫어.");
        return next;
    }

    private ObjectNode output() {
        return (ObjectNode) StructuredJson.parse("""
                {"summary":[
                  {"source_ref":"m1","quote":"붙잡고는 싶은데 애원하는 것처럼 보이긴 싫어."},
                  {"source_ref":"e4","quote":"마지막 음절 ‘마’의 소리가 앞선 음절들보다 길게 이어진다."}],
                 "next_take":{"instruction":"'가지 마'에서 마지막 음절을 길게 늘이지 않고 찍어보세요.",
                   "comparison":"같은 대목에서 말끝의 길이와 원했던 말투를 비교해보세요.","basis_refs":["m1","e4"]}}
                """);
    }

    @Test void generatesOneNewProposalFromDialogueWithoutInventingSelectionOrAttempts() {
        ObjectNode source = handoff();
        ObjectNode note = PracticeNote.assemble(source, text -> {
            JsonNode input = StructuredJson.parse(text);
            assertThat(input.path("coach_handoff").path("conversation")).hasSize(1);
            assertThat(input.path("controls").path("can_propose").asBoolean()).isTrue();
            assertThat(input.has("note_data")).isFalse();
            return output().toString();
        });
        StructuredJson.validate("practice_note", note);
        JsonNode visible = PracticeNote.publicView(note);
        assertThat(visible.path("summary").asText()).contains("라고 했어요", "마지막 음절");
        assertThat(visible.path("practice").path("instruction").asText()).contains("찍어보세요");
        assertThat(visible.path("practice").path("selection").asText()).isEqualTo("proposed");
        assertThat(visible.path("attempts")).isEmpty();
        assertThat(visible.has("conversation")).isFalse();
        assertThat(visible.has("source_catalog")).isFalse();
        assertThat(source).isEqualTo(handoff());
    }

    @Test void existingIdCannotLaunderAnInventedSummaryOrCoachInterpretation() {
        for (String kind : new String[]{"invented", "coach", "old_focus"}) {
            ObjectNode invalid = output();
            ObjectNode excerpt = (ObjectNode) invalid.path("summary").get(0);
            if (kind.equals("invented")) excerpt.put("quote", "연기력이 향상됐어요.");
            if (kind.equals("coach")) excerpt.put("source_ref", "c1").put("quote", "부탁하는 쪽으로 읽힐 수 있어요.");
            if (kind.equals("old_focus")) excerpt.put("source_ref", "e1").put("quote", "고개를 아래로 기울이고 시선도 화면 아래쪽으로 향한다.");
            var failures = new ArrayList<RuntimeException>();
            ObjectNode note = PracticeNote.assemble(handoff(), input -> invalid.toString(), failures::add);
            assertThat(failures).hasSize(2);
            assertThat(note.path("practice").isNull()).isTrue();
            assertThat(note.path("copy").path("summary").path("text").asText()).doesNotContain("향상", "읽힐");
        }
    }

    @Test void missingDirectionEarlyEndAndGenerationFailureDoNotCreateHomework() {
        ObjectNode handoff = handoff();
        ((ObjectNode) handoff.path("context")).putNull("direction").putNull("focus");
        ObjectNode note = PracticeNote.assemble(handoff, text -> {
            assertThat(StructuredJson.parse(text).path("controls").path("can_propose").asBoolean()).isFalse();
            return "{\"summary\":[],\"next_take\":null}";
        });
        assertThat(note.path("mode").asText()).isEqualTo("record_only");
        assertThat(note.path("practice").isNull()).isTrue();
        ObjectNode failed = PracticeNote.assemble(handoff(), input -> { throw new IllegalStateException("offline"); });
        assertThat(failed.path("practice").isNull()).isTrue();
        assertThat(failed.path("copy").path("summary").path("text").asText()).contains("마지막 음절");
    }

    @Test void invalidNextTakeRetriesWithoutPartiallySavingAndUsesTheCorrectPrompt() {
        AtomicInteger calls = new AtomicInteger();
        ObjectNode note = PracticeNote.assemble(handoff(), text -> {
            ObjectNode output = output();
            if (calls.getAndIncrement() == 0) ((ObjectNode) output.path("next_take")).put("selection", "selected");
            else assertThat(StructuredJson.parse(text).has("validation_error")).isTrue();
            return output.toString();
        });
        assertThat(calls).hasValue(2);
        assertThat(note.path("practice").path("selection").asText()).isEqualTo("proposed");
        assertThat(PracticeNote.prompt(handoff())).contains("여기서 처음 제안해도 된다").doesNotContain("note_data에 이미 있는");
    }

    @Test void nextTakeCannotUseAnUnrelatedObservationOrIgnoreTheCurrentDirection() {
        ObjectNode invalid = output();
        ((ObjectNode) invalid.path("next_take")).putArray("basis_refs").add("c2").add("e1");
        ObjectNode note = PracticeNote.assemble(handoff(), text -> invalid.toString());
        assertThat(note.path("practice").isNull()).isTrue();
    }

    @Test void endingBeforeAnsweringTheFirstQuestionKeepsTheFocusButCannotInventANextTake() {
        ObjectNode early = handoff();
        early.put("end_reason", "actor_finished");
        ((ObjectNode) early.path("context")).putNull("direction");
        early.putArray("conversation").addObject().put("id", "m-close").put("role", "actor").put("text", "정리해줘");
        JsonNode existingSources = early.path("source_catalog").deepCopy();
        var earlySources = early.putArray("source_catalog");
        existingSources.forEach(source -> {
            if (source.path("kind").asText().startsWith("video_")) earlySources.add(source);
        });
        earlySources.addObject().put("id", "m-close").put("kind", "actor_message").put("text", "정리해줘")
                .putNull("record_id").putNull("record_version").putNull("start_ms").putNull("end_ms");
        ObjectNode invalid = output();
        invalid.putArray("summary");
        var failures = new ArrayList<RuntimeException>();
        ObjectNode note = PracticeNote.assemble(early, text -> {
            assertThat(StructuredJson.parse(text).path("controls").path("can_propose").asBoolean()).isFalse();
            return invalid.toString(); // Even a model that supplies a plausible exercise is rejected.
        }, failures::add);
        assertThat(failures).hasSize(2).allSatisfy(failure -> assertThat(failure)
                .hasMessageContaining("next take requires actor direction"));
        assertThat(note.path("mode").asText()).isEqualTo("observation");
        assertThat(note.path("practice").isNull()).isTrue();
        assertThat(note.path("attempts")).isEmpty();
    }

    @Test void reportEngineRoutesV2HandoffToTheNewPromptAndInput() {
        var engine = new ReportEngine((system, text) -> {
            assertThat(system).contains("여기서 처음 제안해도 된다");
            assertThat(StructuredJson.parse(text).path("coach_handoff").path("schema_version").asText())
                    .isEqualTo("acttub.coach_handoff.v2");
            return new com.acttub.actingapi.integration.llm.GeneratedText(output().toString(), null, "test");
        }, StructuredJson.MAPPER, new com.acttub.actingapi.support.RecordingLlmTelemetry());
        JsonNode note = engine.generateReport("coaching", null, handoff(), false, "handoff", null, null);
        assertThat(note.path("practice").path("selection").asText()).isEqualTo("proposed");
    }
}
