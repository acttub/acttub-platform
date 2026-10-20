package com.acttub.actingapi.feature.report.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;

import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

/** practice.note: 대화 노트의 다음 테이크·요약 검사 규칙과 실패했을 때 남기는 근거. */
class DialogueNoteRulesTest {
    ObjectNode handoff() {
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

    ObjectNode output(String instruction, String comparison, String... basis) {
        ObjectNode output = (ObjectNode) StructuredJson.parse("""
                {"summary":[{"source_ref":"m1","quote":"붙잡고는 싶은데 애원하는 것처럼 보이긴 싫어."}],"next_take":{}}
                """);
        ArrayNode refs = ((ObjectNode) output.path("next_take")).put("instruction", instruction).put("comparison", comparison)
                .putArray("basis_refs");
        for (String ref : basis) refs.add(ref);
        return output;
    }

    List<String> failures(ObjectNode handoff, ObjectNode output) {
        var errors = new ArrayList<RuntimeException>();
        ObjectNode note = DialogueNote.assembleResult(handoff, text -> output.toString(), errors::add).note();
        assertThat(note.path("practice").isNull()).isTrue();
        return errors.stream().map(RuntimeException::getMessage).toList();
    }

    @Test void aHandoffWithBrokenReferencesIsRejectedBeforeAnyGeneration() {
        ObjectNode duplicate = handoff();
        ((ArrayNode) duplicate.path("source_catalog")).add(duplicate.path("source_catalog").get(0).deepCopy());
        assertThatThrownBy(() -> DialogueNote.assembleResult(duplicate, text -> { throw new AssertionError("no call"); }, f -> { }))
                .hasMessage("duplicate handoff source");
        ObjectNode missingRef = handoff();
        ((ArrayNode) missingRef.path("context").path("focus").path("evidence_refs")).add("e99");
        assertThatThrownBy(() -> DialogueNote.assembleResult(missingRef, text -> { throw new AssertionError("no call"); }, f -> { }))
                .hasMessage("handoff context source is missing");
        ObjectNode missingUtterance = handoff();
        ((ObjectNode) missingUtterance.path("context").path("focus")).put("utterance_ref", "u99");
        assertThatThrownBy(() -> DialogueNote.assembleResult(missingUtterance, text -> { throw new AssertionError("no call"); }, f -> { }))
                .hasMessage("handoff utterance is missing");
    }

    @Test void aSystemFailureEndCannotProposeANextTake() {
        ObjectNode failed = handoff().put("end_reason", "system_failure");
        List<String> errors = failures(failed, output("말끝을 짧게 끊어 보세요.", "말끝 길이를 비교해 보세요.", "m1", "e4"));
        assertThat(errors).containsOnly("next take requires actor direction or a current scene goal and matching video evidence");
    }

    @Test void theNextTakeMustBePlainAndPromiseNothing() {
        assertThat(failures(handoff(), output("말끝을 짧게 끊어 볼까요?", "말끝 길이를 비교해 보세요.", "m1", "e4")))
                .containsOnly("next take must be one plain instruction and comparison");
        assertThat(failures(handoff(), output("말끝을 반드시 짧게 끊어 보세요.", "말끝 길이를 비교해 보세요.", "m1", "e4")))
                .containsOnly("next take must be concrete and must not guarantee improvement");
        assertThat(failures(handoff(), output("말끝을 짧게 끊어 보세요.", "말끝 길이를 비교해 보세요.", "m1", "x9")))
                .containsOnly("next take cites an unavailable source");
    }

    ObjectNode wholeVideo() {
        ObjectNode handoff = handoff();
        ObjectNode focus = (ObjectNode) handoff.path("context").path("focus");
        focus.put("scope", "whole_video").put("pattern", "recurring");
        focus.putArray("evidence_refs").add("e1").add("e4").add("e5");
        return handoff;
    }

    @Test void aWholeVideoNextTakeMustKeepEarlyAndLateEvidence() {
        assertThat(failures(wholeVideo(), output("말끝을 짧게 끊어 보세요.", "말끝 길이를 비교해 보세요.", "m1", "e4")))
                .containsOnly("whole-scene next take must retain evidence from early and late focus ranges");
        ObjectNode note = DialogueNote.assembleResult(wholeVideo(),
                text -> output("처음부터 끝까지 고개를 들고 말해 보세요.", "고개 방향을 비교해 보세요.", "m1", "e1", "e5").toString(),
                failure -> { throw failure; }).note();
        assertThat(note.path("mode").asText()).isEqualTo("action");
        assertThat(note.path("practice").path("instruction").path("text").asText()).isEqualTo("처음부터 끝까지 고개를 들고 말해 보세요.");
    }

    @Test void aSceneFocusFallsBackToTheQuotedLineWhenGenerationFailsAndNoAimRemains() {
        ObjectNode scene = handoff();
        ((ObjectNode) scene.path("context")).putNull("direction");
        ObjectNode focus = (ObjectNode) scene.path("context").path("focus");
        focus.put("basis", "scene");
        focus.putArray("evidence_refs").add("u1");
        var result = DialogueNote.assembleResult(scene, text -> { throw new IllegalStateException("offline"); }, failure -> { });
        assertThat(result.fallback()).isTrue();
        assertThat(result.note().path("copy").path("summary").toString())
                .isEqualTo("{\"text\":\"장면 대사: “가지 마”\",\"source_refs\":[\"u1\"]}");
    }

    @Test void aLongAimIsNotQuotedIntoTheFallbackSummary() {
        String longAim = "붙잡고는 싶은데 애원하는 것처럼 보이긴 싫고 그렇다고 차갑게 보이고 싶지도 않고 그 중간 어딘가였으면 좋겠어.";
        ObjectNode handoff = handoff();
        ((ObjectNode) handoff.path("context").path("direction")).put("text", longAim);
        ((ObjectNode) handoff.path("conversation").get(0)).put("text", longAim);
        handoff.path("source_catalog").forEach(source -> {
            if (source.path("id").asText().equals("m1")) ((ObjectNode) source).put("text", longAim);
        });
        JsonNode summary = DialogueNote.assembleResult(handoff, text -> { throw new IllegalStateException("offline"); }, failure -> { })
                .note().path("copy").path("summary");
        assertThat(summary.path("source_refs").toString()).isEqualTo("[\"e4\"]");
    }
}
