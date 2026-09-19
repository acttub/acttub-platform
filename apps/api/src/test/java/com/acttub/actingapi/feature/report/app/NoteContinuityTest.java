package com.acttub.actingapi.feature.report.app;

import static org.assertj.core.api.Assertions.assertThat;
import java.util.ArrayList;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class NoteContinuityTest {
    @Test void sceneGoalAndDialogueSupportAnAnalysisPracticeWithoutDeliveryObservations() {
        var handoff = NoteContinuityFixtures.scene();
        var errors = new ArrayList<RuntimeException>();
        var note = PracticeNote.assemble(handoff, text -> {
            JsonNode controls = StructuredJson.parse(text).path("controls");
            assertThat(controls.path("can_propose").asBoolean()).isTrue();
            assertThat(controls.path("next_take_basis").asText()).isEqualTo("scene");
            assertThat(controls.path("aim").path("text").asText()).contains("열쇠를 돌려받");
            return NoteContinuityFixtures.output().toString();
        }, errors::add);
        assertThat(errors).isEmpty();
        var visible = PracticeNote.publicView(note);
        assertThat(visible.path("summary").asText()).contains("장면 대사:", "라고 했어요");
        assertThat(visible.path("practice").path("instruction").asText()).contains("열쇠를 돌려주도록");
        assertThat(visible.path("focus").path("start_ms").asLong()).isEqualTo(1000);
        assertThat(visible.path("focus").path("end_ms").asLong()).isEqualTo(11000);
        assertThat(visible.path("focus").path("quote").isNull()).isTrue();
        assertThat(visible.has("controls")).isFalse();
        assertThat(visible.path("attempts")).isEmpty();
    }

    @Test void transcriptCannotSubstituteForDeliveryEvidence() {
        var handoff = NoteContinuityFixtures.scene();
        ((ObjectNode) handoff.path("context").path("focus")).put("basis", "delivery");
        ((ObjectNode) handoff.path("context")).set("direction", handoff.path("context").path("scene_context").path("character_goal"));
        var errors = new ArrayList<RuntimeException>();
        var note = PracticeNote.assemble(handoff, text -> {
            assertThat(StructuredJson.parse(text).path("controls").path("can_propose").asBoolean()).isFalse();
            return NoteContinuityFixtures.output().toString();
        }, errors::add);
        assertThat(errors).hasSize(2);
        assertThat(note.path("practice").isNull()).isTrue();
        assertThat(PracticeNote.publicView(note).path("summary").asText()).doesNotContain("장면 대사");
    }

    @Test void wholeScenePracticeCannotCiteOnlyTheRepresentativeLine() {
        var output = NoteContinuityFixtures.output();
        ((ObjectNode) output.path("next_take")).putArray("basis_refs").add("actor-goal").add("u1");
        var errors = new ArrayList<RuntimeException>();
        var note = PracticeNote.assemble(NoteContinuityFixtures.scene(), text -> output.toString(), errors::add);
        assertThat(errors).hasSize(2).allSatisfy(e -> assertThat(e.getMessage()).contains("early and late"));
        assertThat(note.path("practice").isNull()).isTrue();
    }

    @Test void aLimitationAloneCannotJustifyAPractice() {
        var handoff = NoteContinuityFixtures.scene();
        NoteContinuityFixtures.source(handoff, "limit", "record_limitation", "손이 화면 밖이다.", 0, 12000);
        ((ObjectNode) handoff.path("context").path("focus")).putArray("evidence_refs").add("limit");
        var note = PracticeNote.assemble(handoff, text -> {
            assertThat(StructuredJson.parse(text).path("controls").path("can_propose").asBoolean()).isFalse();
            return "{\"summary\":[],\"next_take\":null}";
        });
        assertThat(note.path("practice").isNull()).isTrue();
    }

    @Test void staleActorGoalCannotSurviveALaterCorrection() {
        var handoff = NoteContinuityFixtures.scene();
        NoteContinuityFixtures.message(handoff, "correction", "actor", "아니, 열쇠를 돌려받으려는 것도 아니에요. 목적은 아직 모르겠어요.");
        var note = PracticeNote.assemble(handoff, text -> {
            assertThat(StructuredJson.parse(text).path("controls").path("can_propose").asBoolean()).isFalse();
            return NoteContinuityFixtures.output().toString();
        });
        assertThat(note.path("practice").isNull()).isTrue();
        assertThat(PracticeNote.publicView(note).path("summary").asText()).doesNotContain("돌려받으려는 거예요");
        assertThat(note.path("scene_context").path("character_goal").isNull()).isTrue();
        assertThat(PracticeNote.publicView(note).path("focus").isNull()).isTrue();
    }

    @Test void anotherVideoOrMissingVideoCannotGroundANewPractice() {
        for (boolean missing : new boolean[]{false, true}) {
            var handoff = NoteContinuityFixtures.scene();
            if (missing) handoff.putNull("record_ref");
            else ((ObjectNode) handoff.path("record_ref")).put("version", 2);
            var note = PracticeNote.assemble(handoff, text -> {
                assertThat(StructuredJson.parse(text).path("controls").path("can_propose").asBoolean()).isFalse();
                return NoteContinuityFixtures.output().toString();
            });
            assertThat(note.path("practice").isNull()).isTrue();
        }
    }

    @Test void failureRetainsTheCorrectedGoalWithoutInventingHomework() {
        var note = PracticeNote.assemble(NoteContinuityFixtures.scene(), text -> { throw new IllegalStateException("offline"); });
        assertThat(PracticeNote.publicView(note).path("summary").asText()).contains("열쇠를 돌려받으려는");
        assertThat(note.path("practice").isNull()).isTrue();
    }
}
