package com.acttub.actingapi.feature.report.app;

import static org.assertj.core.api.Assertions.*;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class PracticeNoteTest {
    ObjectNode handoff() { return (ObjectNode) StructuredJson.resource("/coaching/handoff.json").deepCopy(); }
    @Test void copyCannotOverwritePracticeOrUpgradeExecutionAndPublicViewExcludesPrivateMessages() {
        ObjectNode handoff = handoff();
        ObjectNode note = PracticeNote.assemble(handoff, input -> "{\"title\":\"성공\",\"summary\":null,\"tested\":true}");
        StructuredJson.validate("practice_note", note);
        assertThat(note.path("practice").path("instruction")).isEqualTo(handoff.path("coaching_state").path("proposals").get(0).path("instruction"));
        assertThat(note.path("attempts").get(0).path("execution").asText()).isEqualTo("not_tried");
        assertThat(note.path("attempts").get(0).path("result").isNull()).isTrue();
        JsonNode visible = PracticeNote.publicView(note);
        assertThat(visible.has("source_catalog")).isFalse();
        assertThat(visible.has("coaching_state")).isFalse();
        assertThat(visible.path("note_id")).isEqualTo(note.path("note_id"));
        assertThat(visible.path("focus").path("start_ms").asInt()).isEqualTo(4000);
    }
    @Test void copyFailureStillProducesAValidSavedNote() {
        ObjectNode note = PracticeNote.assemble(handoff(), input -> { throw new IllegalStateException("unavailable"); });
        assertThat(note.path("lifecycle").asText()).isEqualTo("saved");
        assertThat(note.path("copy").path("summary").isNull()).isTrue();
    }
    @Test void earlyFinishNeedsNeitherPracticeNorConfirmation() {
        ObjectNode handoff = handoff();
        ObjectNode state = (ObjectNode) handoff.path("coaching_state");
        state.putArray("proposals"); state.putArray("attempts"); state.putNull("active_proposal_id");
        ObjectNode context = (ObjectNode) state.path("context");
        context.putNull("direction").putNull("focus").putNull("reading");
        ObjectNode note = PracticeNote.assemble(handoff, input -> "{\"title\":\"이번 대화 기록\",\"summary\":null}");
        assertThat(note.path("mode").asText()).isEqualTo("record_only");
        assertThat(note.path("practice").isNull()).isTrue();
    }
    @Test void aValidSourceIdCannotLaunderInventedImprovementIntoTheSummary() {
        ObjectNode note = PracticeNote.assemble(handoff(), input ->
                "{\"title\":\"말끝\",\"summary\":{\"text\":\"연습으로 표현이 완벽해졌다.\",\"source_refs\":[\"m2\"]}}");
        assertThat(note.path("copy").path("summary").isNull()).isTrue();
    }
    @Test void titleCannotInventACompletedImprovement() {
        ObjectNode note = PracticeNote.assemble(handoff(), input ->
                "{\"title\":\"연습으로 연기력 향상 완료\",\"summary\":null}");
        assertThat(note.path("copy").path("title").asText()).doesNotContain("향상 완료");
        assertThat(note.path("copy").path("title").asText()).isEqualTo(note.path("focus").path("label").asText());
    }
    @Test void legacyReportRemainsIdentical() {
        JsonNode legacy = StructuredJson.parse("{\"report_type\":\"analysis\",\"title\":\"예전 노트\"}");
        assertThat(PracticeNote.publicView(legacy)).isSameAs(legacy);
    }
    @Test void sceneContextIsKeptInTheStoredNoteAndModelInputButNotInThePublicView() {
        ObjectNode handoff = handoff();
        ObjectNode scene = (ObjectNode) handoff.path("coaching_state").path("context").path("scene_context");
        scene.set("situation", StructuredJson.parse(
                "{\"text\":\"떠나려는 상대를 붙잡는 장면\",\"origin\":\"actor_stated\",\"source_refs\":[\"m1\"]}"));
        ObjectNode note = PracticeNote.assemble(handoff, input -> {
            assertThat(input).contains("떠나려는 상대를 붙잡는 장면");
            return "{\"title\":\"이번 대화 기록\",\"summary\":null}";
        });
        StructuredJson.validate("practice_note", note);
        assertThat(note.path("scene_context").path("situation").path("text").asText()).isEqualTo("떠나려는 상대를 붙잡는 장면");
        assertThat(PracticeNote.publicView(note).has("scene_context")).isFalse();
    }
    @Test void copyFailureIsReportedInsteadOfSwallowed() {
        java.util.List<RuntimeException> seen = new java.util.ArrayList<>();
        ObjectNode note = PracticeNote.assemble(handoff(), input -> { throw new IllegalStateException("unavailable"); }, seen::add);
        assertThat(seen).hasSize(1);
        assertThat(seen.get(0)).hasMessage("unavailable");
        assertThat(note.path("copy").path("title").asText()).isEqualTo(note.path("focus").path("label").asText());
        seen.clear();
        PracticeNote.assemble(handoff(), input -> "{\"title\":\"연습으로 연기력 향상 완료\",\"summary\":null}", seen::add);
        assertThat(seen).hasSize(1);
        assertThat(seen.get(0)).hasMessageContaining("title");
    }
}
