package com.acttub.actingapi.feature.report.app;

import static org.assertj.core.api.Assertions.assertThat;
import java.util.ArrayList;
import java.util.List;
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

    /**
     * account.profile: 구조화 노트의 모델 입력에는 프로필이 handoff 와 <b>나란히</b> 실린다. handoff 도, 만든
     * 노트도, 공개 응답도 프로필을 갖지 않는다. 프로필이 없는 배우의 입력은 글자 하나 다르지 않다.
     */
    @Test void accountProfile_actorProfileTravelsBesideTheHandoffAndNeverIntoTheNote() {
        var handoff = NoteContinuityFixtures.scene();
        java.util.UUID member = java.util.UUID.randomUUID();
        var inputs = new ArrayList<String>();
        var prompts = new ArrayList<String>();
        var engine = new ReportEngine((system, text) -> {
            prompts.add(system);
            inputs.add(text);
            return new com.acttub.actingapi.integration.llm.GeneratedText(
                    NoteContinuityFixtures.output().toString(), null, "test");
        }, StructuredJson.MAPPER, new com.acttub.actingapi.support.RecordingLlmTelemetry(),
                userId -> member.equals(userId) ? NoteContinuityFixtures.profile() : null);

        JsonNode note = engine.generateReport("coaching", null, handoff, false, "handoff", null, null, null, member);
        engine.generateReport("coaching", null, handoff, false, "handoff", null, null, null, java.util.UUID.randomUUID());
        engine.generateReport("coaching", null, handoff, false, "handoff", null, null);

        ObjectNode withProfile = (ObjectNode) StructuredJson.parse(inputs.get(0));
        assertThat(withProfile.path("actor_profile")).isEqualTo(StructuredJson.parse("""
                {"name":"김하늘","gender":"여성","age":19,"directions":["무대(연극·뮤지컬)"],
                 "experience":"입시생","goal":"전문 배우"}
                """));
        assertThat(withProfile.path("coach_handoff").has("actor_profile")).isFalse();
        // 프로필 키 하나를 빼면 프로필이 없는 배우의 입력과 같다 — 더해진 것은 그 키뿐이다.
        ObjectNode withoutTheKey = withProfile.deepCopy();
        withoutTheKey.remove("actor_profile");
        assertThat(withoutTheKey).isEqualTo(StructuredJson.parse(inputs.get(1)));
        assertThat(prompts.get(0)).endsWith(ReportEngine.ACTOR_PROFILE_INSTRUCTION)
                .startsWith(PracticeNote.prompt(handoff));
        assertThat(handoff).as("handoff 를 건드리지 않는다").isEqualTo(NoteContinuityFixtures.scene());
        assertThat(note.toString()).doesNotContain("김하늘", "입시생", "actor_profile");
        assertThat(PracticeNote.publicView(note).toString()).doesNotContain("김하늘", "입시생");

        // 프로필이 없는 배우(게스트·미완성)와, 누구의 노트인지 모르는 호출.
        for (int absent : List.of(1, 2)) {
            assertThat(StructuredJson.parse(inputs.get(absent)).has("actor_profile")).isFalse();
            assertThat(prompts.get(absent)).isEqualTo(PracticeNote.prompt(handoff));
        }
        assertThat(inputs.get(1)).as("바이트 단위로 같다").isEqualTo(inputs.get(2));
        assertThat(inputs.get(0)).isNotEqualTo(inputs.get(1));
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
