package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.feature.report.app.ReportEngine;
import com.acttub.actingapi.support.CoachQualityRun;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/** 명시적으로 켤 때만 유료 실호출. 합성 사례와 응답은 build/coach-quality-eval에 남긴다. */
@EnabledIfEnvironmentVariable(named = "ACTTUB_COACH_EVAL", matches = "1")
class CoachQualityEvalTest {
    private static final ObjectMapper MAPPER = CoachQualityRun.MAPPER;

    @TestFactory
    Stream<DynamicTest> syntheticScenarios() throws Exception {
        // 명시적으로 실행한 평가에서 키 누락은 skipped 성공이 아니라 실패다.
        assertThat(System.getenv("OPENAI_API_KEY")).as("실호출 평가에는 OPENAI_API_KEY가 필요하다").isNotBlank();
        JsonNode scenarios;
        try (var input = getClass().getResourceAsStream("/coach/quality-scenarios.json")) {
            scenarios = MAPPER.readTree(input);
        }
        String selection = System.getenv("ACTTUB_COACH_EVAL_CASES");
        Set<String> selected = selection == null || selection.isBlank()
                ? Set.of() : Set.copyOf(Arrays.stream(selection.split(",", -1)).map(String::strip).toList());
        List<JsonNode> cases = new ArrayList<>();
        scenarios.forEach(cases::add);
        if (!selected.isEmpty()) {
            assertThat(cases.stream().map(item -> item.path("id").asText()).toList()).containsAll(selected);
        }
        return cases.stream().filter(item -> selected.isEmpty() || selected.contains(item.path("id").asText()))
                .map(item -> DynamicTest.dynamicTest(item.path("id").asText(), () -> evaluate(item)));
    }

    private static void evaluate(JsonNode scenario) throws Exception {
        try (var run = new CoachQualityRun(scenario.path("id").asText())) {
            run.output.set("scenario", scenario);
            CoachSessionSnapshot session = session(scenario);
            CoachEngine engine = new CoachEngine(run.generator("coach"), run.reporter, run.telemetry);
            int maxChars = scenario.path("max_chars").asInt(0);
            CoachResult result = run.step(engine, session,
                    scenario.path("start").asBoolean() ? null : scenario.path("latest").asText(), maxChars);
            for (JsonNode followup : scenario.path("followups")) {
                // 미리 쓴 AI 답변 대신 직전에 실제로 생성한 대화 이력을 이어 쓴다.
                result = run.step(engine, result.session(), followup.asText(), maxChars);
            }
            CoachReply reply = result.reply();
            run.output.set("reply", MAPPER.valueToTree(reply));
            if (scenario.path("close").asBoolean()) {
                assertThat(reply.status()).isEqualTo("complete");
                assertThat(reply.handoff().path("completion_level").asText()).isNotEqualTo("unavailable");
            }
            if (scenario.has("tested")) {
                assertThat(reply.handoff().at("/experiment/tested").isBoolean()).isTrue();
                assertThat(reply.handoff().at("/experiment/tested").asBoolean())
                        .isEqualTo(scenario.path("tested").asBoolean());
                if (!scenario.path("tested").asBoolean()) {
                    assertThat(reply.handoff().path("observed_change").isNull()).isTrue();
                }
            }
            if (scenario.path("report").asBoolean()) {
                run.output.set("report", new ReportEngine(run.generator("report"), MAPPER, run.telemetry).generateReport(
                        "표현".equals(session.blockageKind()) ? "expression" : "analysis",
                        session.observationPack(), reply.handoff(), true, "synthetic-handoff", null, null));
            }
            run.passed();
        }
    }

    private static CoachSessionSnapshot session(JsonNode scenario) {
        List<CoachTurnSnapshot> turns = new ArrayList<>();
        for (JsonNode text : scenario.path("turns")) {
            turns.add(new CoachTurnSnapshot(turns.size() % 2 == 0 ? "actor" : "ai", text.asText()));
        }
        List<String> transcripts = new ArrayList<>();
        scenario.path("transcripts").forEach(text -> transcripts.add(text.asText()));
        ObjectNode pack = MAPPER.createObjectNode();
        for (String field : List.of("scene_summary", "timeline", "speech")) {
            if (scenario.has(field)) pack.set(field, scenario.get(field));
        }
        pack.set("observations", scenario.path("observations"));
        pack.set("uncertainties", scenario.path("uncertainties"));
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                pack, scenario.path("situation").asText(), scenario.path("character").asText(),
                scenario.path("goal").asText(), scenario.path("duration_ms").asInt(12000),
                scenario.path("branch").asText(), scenario.path("sub_branch").asText("그 외"),
                scenario.path("detail").asText(), transcripts, scenario.path("summary").asText(),
                null, "open", "", turns);
    }
}
