package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.feature.report.app.ReportEngine;
import com.acttub.actingapi.integration.llm.OpenAiResponsesClient;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.TestFactory;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/** 명시적으로 켤 때만 유료 실호출. 합성 사례와 응답만 build/coach-quality-eval에 남긴다. */
@EnabledIfEnvironmentVariable(named = "ACTTUB_COACH_EVAL", matches = "1")
@EnabledIfEnvironmentVariable(named = "OPENAI_API_KEY", matches = ".+")
class CoachQualityEvalTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @TestFactory
    Stream<DynamicTest> syntheticScenarios() throws Exception {
        JsonNode scenarios;
        try (var input = getClass().getResourceAsStream("/coach/quality-scenarios.json")) {
            scenarios = MAPPER.readTree(input);
        }
        String selection = System.getenv("ACTTUB_COACH_EVAL_CASES");
        Set<String> selected = selection == null || selection.isBlank()
                ? Set.of() : Set.copyOf(Arrays.asList(selection.split(",")));
        List<JsonNode> cases = new ArrayList<>();
        scenarios.forEach(cases::add);
        if (!selected.isEmpty()) {
            assertThat(cases.stream().map(item -> item.path("id").asText()).toList()).containsAll(selected);
        }
        return cases.stream().filter(item -> selected.isEmpty() || selected.contains(item.path("id").asText()))
                .map(item -> DynamicTest.dynamicTest(item.path("id").asText(), () -> evaluate(item)));
    }

    private static void evaluate(JsonNode scenario) throws Exception {
        String id = scenario.path("id").asText();
        ObjectNode output = MAPPER.createObjectNode();
        output.put("id", id);
        output.put("started_at", Instant.now().toString());
        output.set("scenario", scenario);
        ArrayNode calls = output.putArray("calls");
        String[] phase = {"coach"};
        TextGenerator client = new OpenAiResponsesClient(MAPPER);
        TextGenerator recording = (system, input) -> {
            long started = System.nanoTime();
            var generated = client.generate(system, input);
            ObjectNode call = calls.addObject();
            call.put("phase", phase[0]);
            call.put("elapsed_ms", (System.nanoTime() - started) / 1_000_000);
            call.put("input", input);
            call.put("response", generated.text());
            call.set("usage", MAPPER.valueToTree(generated.usage()));
            return generated;
        };
        try {
            CoachSessionSnapshot session = session(scenario);
            CoachReply reply = new CoachEngine(recording, new RecordingFailureReporter())
                    .reply(session, scenario.path("latest").asText(), UUID.randomUUID()).reply();
            output.set("reply", MAPPER.valueToTree(reply));
            assertThat(reply.message()).isNotBlank();
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
                phase[0] = "report";
                output.set("report", new ReportEngine(recording, MAPPER).generateReport(
                        "표현".equals(session.blockageKind()) ? "expression" : "analysis",
                        session.observationPack(), reply.handoff(), true, "synthetic-handoff", null, null));
            }
            output.put("contract_checks", "passed");
            // 해석 정확성·직접 답변·근거성은 저장된 출력과 review 기준을 별도로 대조해야 한다.
            output.put("semantic_review", "pending");
        } catch (Exception | AssertionError failure) {
            output.put("failure_type", failure.getClass().getSimpleName());
            output.put("failure", failure.getMessage());
            throw failure;
        } finally {
            output.put("finished_at", Instant.now().toString());
            Path directory = Path.of("build", "coach-quality-eval");
            Files.createDirectories(directory);
            MAPPER.writerWithDefaultPrettyPrinter().writeValue(directory.resolve(id + ".json").toFile(), output);
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
                pack, scenario.path("situation").asText(), scenario.path("character").asText("동료"),
                scenario.path("goal").asText(), 12000, scenario.path("branch").asText(),
                scenario.path("sub_branch").asText("그 외"), scenario.path("detail").asText(), transcripts,
                scenario.path("summary").asText(), null, "open", "", turns);
    }
}
