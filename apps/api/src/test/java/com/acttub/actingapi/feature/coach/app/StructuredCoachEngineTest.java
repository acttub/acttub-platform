package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

class StructuredCoachEngineTest {
    private CoachSessionSnapshot session() {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.resource("/coaching/record.json"), "", "", "", 8000, "그 외", "그 외", null,
                List.of(), "", null, "open", "", List.of()).withCoachingState("three_layers_v1", 0, null, "open", "");
    }
    private CoachEngine engine(TextGenerator generator) {
        return new CoachEngine(generator, new RecordingFailureReporter(), new RecordingLlmTelemetry());
    }
    static ObjectNode respond(JsonNode input, String text, String flow) {
        ObjectNode output = StructuredJson.MAPPER.createObjectNode().put("action", "respond")
                .put("base_state_revision", input.path("coaching_state").path("revision").asLong())
                .put("message", text).putNull("context_update").putNull("style_update").put("flow", flow);
        ObjectNode link = output.putObject("reply_link").put("move", "finish".equals(flow) ? "close" : input.path("user_message").isNull() ? "open" : "explain");
        ObjectNode selection = link.putObject("selection").put("need", "장면 이해").put("blocker", "scene_understanding");
        selection.putArray("known_refs");
        if (OpeningQuestion.questionCount(text) > 0) selection.putObject("question")
                .put("missing_information", "현재 장면의 이유").put("help_if_answered", "장면에 맞는 설명을 연결한다");
        else selection.putNull("question");
        link.set("user_message_id", input.path("user_message").isNull() ? StructuredJson.MAPPER.nullNode() : input.path("user_message").path("id"));
        if (input.path("user_message").isNull()) link.putNull("actor_quote");
        else link.put("actor_quote", input.path("user_message").path("text").asText());
        var refs = link.putArray("evidence_refs");
        if (input.path("user_message").isNull() && "continue".equals(flow)) {
            JsonNode selected = null;
            for (JsonNode source : input.path("record_view").path("source_catalog")) {
                if (OpeningQuestion.videoSource(source)) {
                    selected = source;
                    if ("video_observation".equals(source.path("kind").asText())) break;
                }
            }
            if (selected != null) {
                refs.add(selected.path("id").asText());
                ObjectNode context = input.path("coaching_state").path("context").deepCopy();
                ObjectNode focus = context.putObject("focus").put("label", "가지 마 대사").putNull("utterance_ref");
                focus.putArray("evidence_refs").add(selected.path("id").asText());
                output.set("context_update", context);
            }
        }
        return output;
    }
    static GeneratedText generated(JsonNode output) { return new GeneratedText(output.toString(), null, "test"); }
    /**
     * account.profile: 구조화 경로에도 같은 뜻의 {@code actor_profile} 이 독립 키로 실린다. 기억의 성별·나이는
     * 빠지고 목표는 남으며, 프로필을 어떻게 쓸지의 지시는 프로필이 있을 때만 붙는다.
     */
    @Test void accountProfile_completeProfileTravelsAsItsOwnKeyAndReplacesRememberedDemographics() {
        ActorProfile profile = new ActorProfile("김배우", "선택 안 함", 25, List.of("매체(TV·영화)", "무대(연극·뮤지컬)"), "5년 이상", "전문 배우");
        PriorContext prior = new PriorContext(java.util.Map.of("gender", "남", "age", "31", "goal", "입시 합격"),
                null, true, List.of(), List.of());
        engine((system, text) -> {
            JsonNode input = StructuredJson.parse(text);
            assertThat(input.path("actor_profile")).isEqualTo(StructuredJson.parse("""
                    {"name":"김배우","gender":"선택 안 함","age":25,
                     "directions":["매체(TV·영화)","무대(연극·뮤지컬)"],"experience":"5년 이상","goal":"전문 배우"}
                    """));
            assertThat(input.path("prior_context").path("memory")).isEqualTo(StructuredJson.parse("{\"goal\":\"입시 합격\"}"));
            assertThat(system).endsWith(StructuredCoachEngine.ACTOR_PROFILE_INSTRUCTION);
            return generated(respond(input, "“가지 마”를 듣고 상대가 어떻게 하길 바랐어요?", "continue"));
        }).start(session().withPrior(prior).withActorProfile(profile), UUID.randomUUID());
    }
    @Test void accountProfile_withoutAProfileTheStructuredInputHasNoKeyNoInstructionAndTheWholeMemory() {
        PriorContext prior = new PriorContext(java.util.Map.of("gender", "남", "age", "31"), null, true, List.of(), List.of());
        List<String> withoutProfile = new ArrayList<>();
        List<String> withNullProfile = new ArrayList<>();
        UUID operation = UUID.randomUUID();
        CoachSessionSnapshot session = session().withPrior(prior);
        engine((system, text) -> {
            JsonNode input = StructuredJson.parse(text);
            assertThat(input.has("actor_profile")).isFalse();
            assertThat(input.path("prior_context").path("memory").path("gender").asText()).isEqualTo("남");
            assertThat(system).doesNotContain("actor_profile");
            withoutProfile.add(system + "\n" + text);
            return generated(respond(input, "“가지 마”를 듣고 상대가 어떻게 하길 바랐어요?", "continue"));
        }).start(session, operation);
        engine((system, text) -> {
            withNullProfile.add(system + "\n" + text);
            return generated(respond(StructuredJson.parse(text), "“가지 마”를 듣고 상대가 어떻게 하길 바랐어요?", "continue"));
        }).start(session.withActorProfile(null), operation);
        assertThat(withNullProfile).as("미완성 프로필·게스트의 모델 입력은 바이트 단위로 같다").isEqualTo(withoutProfile);
    }
    @Test void videoOnlyStartsWithoutInventingActorInput() {
        CoachResult result = engine((system, text) -> {
            JsonNode input = StructuredJson.parse(text);
            assertThat(input.path("user_message").isNull()).isTrue();
            assertThat(input.path("recent_messages")).isEmpty();
            assertThat(system).contains("출력 계약의 실제 JSON Schema");
            return generated(respond(input, "“가지 마”를 듣고 상대가 어떻게 하길 바랐어요?", "continue"));
        }).start(session(), UUID.randomUUID());
        assertThat(result.session().turns()).containsExactly(new CoachTurnSnapshot("ai", result.reply().message()));
        assertThat(result.session().stateRevision()).isEqualTo(1);
    }
    @Test void lookupIsHiddenAndDeliversActualContextToNextCall() {
        AtomicInteger calls = new AtomicInteger();
        CoachResult result = engine((system, text) -> {
            JsonNode input = StructuredJson.parse(text);
            if (calls.getAndIncrement() == 0) {
                ObjectNode output = StructuredJson.MAPPER.createObjectNode().put("action", "lookup").put("base_state_revision", 0);
                ObjectNode request = output.putObject("request");
                request.set("record_ref", input.path("record_view").path("record_ref"));
                request.putObject("selector").put("kind", "utterance").put("utterance_id", "u1");
                request.put("include_neighbors", true).putNull("continuation_token").putArray("dimensions").add("voice");
                return generated(output);
            }
            assertThat(input.path("record_view").path("source_catalog").toString()).contains("e4", "길게 이어진다");
            assertThat(input.path("record_view").path("segments")).hasSize(3);
            return generated(respond(input, "마지막 음절의 소리가 길게 이어져요. 상대가 어떻게 반응하길 바랐어요?", "continue"));
        }).start(session(), UUID.randomUUID());
        assertThat(calls).hasValue(2);
        assertThat(result.session().turns()).hasSize(1);
    }
    @Test void malformedOutputNeverLeaksAndTenthReplyCanAlwaysFinish() {
        List<CoachTurnSnapshot> turns = new ArrayList<>();
        for (int i = 0; i < 9; i++) turns.add(new CoachTurnSnapshot("ai", "확인한 구간이에요."));
        AtomicInteger calls = new AtomicInteger();
        CoachResult result = engine((system, text) -> {
            calls.incrementAndGet();
            return generated(respond(StructuredJson.parse(text), "위조된 내용".repeat(80), "continue"));
        }).reply(session().withTurns(turns), "네", UUID.randomUUID());
        assertThat(calls).hasValue(4);
        assertThat(result.reply().status()).isEqualTo("complete");
        assertThat(result.session().status()).isEqualTo("closed");
        assertThat(result.reply().message()).doesNotContain("위조");
        assertThat(result.session().coachingState().path("attempts")).isEmpty();
    }
    @Test void brevityPreferenceSurvivesAnUninformativeNextReply() {
        CoachResult result = engine((system, text) -> generated(respond(StructuredJson.parse(text), "말끝 한 곳만 살펴봐요.", "continue")))
                .reply(session(), "너무 길어", UUID.randomUUID());
        assertThat(result.session().coachingState().path("response_style").asText()).isEqualTo("brief");
        engine((system, text) -> {
            JsonNode input = StructuredJson.parse(text);
            assertThat(input.path("controls").path("max_message_chars").asInt()).isEqualTo(80);
            return generated(respond(input, "말끝이 이어지는 구간부터 볼게요.", "continue"));
        }).reply(result.session(), "응", UUID.randomUUID());
    }
    @Test void denseSingleSegmentCanBeReadAcrossBoundedPagesWithoutLosingFacts() {
        ObjectNode record = session().observationPack().deepCopy();
        ObjectNode template = (ObjectNode) record.path("events").get(0).deepCopy();
        var events = record.putArray("events");
        ObjectNode segment = (ObjectNode) record.path("segments").get(0).deepCopy();
        segment.put("end_ms", 8000);
        segment.putArray("utterance_ids").add("u1");
        var eventIds = segment.putArray("event_ids");
        record.putArray("segments").add(segment);
        for (int i = 0; i < 160; i++) {
            String id = "dense:" + i;
            events.add(template.deepCopy().put("id", id).put("description", "확인된 움직임을 기록한다. ".repeat(20)));
            eventIds.add(id);
        }
        var words = ((ObjectNode) record.path("speech").path("word_timings")).put("status", "recorded").putArray("items");
        for (int i = 0; i < 600; i++) words.addObject().put("id", "word:" + i).put("text", "대사")
                .put("start_ms", i * 10).put("end_ms", i * 10 + 5).put("timing_basis", "aligned");
        ObjectNode request = StructuredJson.MAPPER.createObjectNode();
        request.set("record_ref", com.acttub.actingapi.integration.observation.VideoRecord.reference(record));
        request.putObject("selector").put("kind", "range").put("start_ms", 0).put("end_ms", 8000);
        request.put("include_neighbors", false).putNull("continuation_token").putArray("dimensions");
        var ids = new java.util.HashSet<String>();
        var wordIds = new java.util.HashSet<String>();
        var cursors = new java.util.HashSet<String>();
        CoachRecordLookup lookup = new CoachRecordLookup();
        int pages = 0;
        while (true) {
            JsonNode result = lookup.lookup(record, request);
            assertThat(result.toString().length()).isLessThanOrEqualTo(CoachRecordLookup.MAX_RESULT_CHARS);
            assertThat(result.path("status").asText()).isIn("ok", "partial");
            result.path("events").forEach(e -> ids.add(e.path("id").asText()));
            result.path("speech").path("word_timings").path("items").forEach(w -> wordIds.add(w.path("id").asText()));
            assertThat(++pages).isLessThan(100);
            if (!result.path("has_more").asBoolean()) break;
            assertThat(cursors.add(result.path("continuation_token").asText())).isTrue();
            request.set("continuation_token", result.path("continuation_token"));
        }
        assertThat(pages).isGreaterThan(1);
        assertThat(ids).hasSize(160);
        assertThat(wordIds).hasSize(600);
        request.putNull("continuation_token");
        request.putArray("dimensions").add("voice");
        assertThat(lookup.lookup(record, request).path("events")).isEmpty();
        request.set("continuation_token", StructuredJson.MAPPER.getNodeFactory().textNode(cursors.iterator().next()));
        assertThatThrownBy(() -> lookup.lookup(record, request)).hasMessageContaining("invalid lookup continuation");
    }

    @Test void askingToSummarizeALineDoesNotForceTheConversationToEnd() {
        engine((system, text) -> {
            JsonNode input = StructuredJson.parse(text);
            assertThat(input.path("controls").path("finish_required").asBoolean()).isFalse();
            return generated(respond(input, "상대가 떠나지 않기를 바란다는 뜻의 말이에요.", "continue"));
        }).reply(session(), "이 대사 의도를 정리해줘", UUID.randomUUID());
    }
    @Test void lookupRejectsForeignRecordsAndReportsUnavailableData() {
        CoachRecordLookup lookup = new CoachRecordLookup();
        ObjectNode request = StructuredJson.MAPPER.createObjectNode();
        request.putObject("record_ref").put("record_id", "other").put("version", 1).put("duration_ms", 8000);
        assertThatThrownBy(() -> lookup.lookup(session().observationPack(), request)).hasMessageContaining("session record");
        assertThat(lookup.lookup(null, request).path("status").asText()).isEqualTo("unavailable");
    }
}
