package com.acttub.actingapi.report;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;

import com.acttub.actingapi.llm.GeneratedText;
import com.acttub.actingapi.llm.TokenUsage;
import com.acttub.actingapi.llm.TextGenerator;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class ReportEngineTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void unconfirmedOrMissingAnalysisHandoffIsBlockedWithoutLlmCall() throws Exception {
        RecordingGenerator generator = new RecordingGenerator();
        ReportEngine engine = new ReportEngine(generator, MAPPER);

        JsonNode unconfirmed = engine.generateReport(
                "analysis", pack(), handoff(), false, "handoff", null, null);
        JsonNode missing = engine.generateReport(
                "analysis", pack(), null, true, "handoff", null, null);

        assertThat(unconfirmed).isEqualTo(MAPPER.readTree("""
                {"report_type":"blocked","reason":"confirmed_analysis_handoff_required"}
                """));
        assertThat(missing).isEqualTo(unconfirmed);
        assertThat(generator.inputs).isEmpty();
    }

    @Test
    void expressionRequiresTestedInstructionAndObservedChangeWithoutCallingLlm() throws Exception {
        for (JsonNode invalid : List.of(
                expressionHandoff(false, "실험", "변화"),
                expressionHandoff(true, "   ", "변화"),
                expressionHandoff(true, "실험", "   "))) {
            RecordingGenerator generator = new RecordingGenerator();
            JsonNode report = new ReportEngine(generator, MAPPER).generateReport(
                    "expression", pack(), invalid, true, "expression-id", null, null);

            assertThat(report).isEqualTo(MAPPER.readTree("""
                    {"report_type":"blocked","reason":"confirmed_expression_handoff_required"}
                    """));
            assertThat(generator.inputs).isEmpty();
        }
    }

    @Test
    void expressionCallsLlmOnlyWhenAllThreeReadinessConditionsPasses() throws Exception {
        RecordingGenerator generator = new RecordingGenerator(expressionReport());
        JsonNode report = new ReportEngine(generator, MAPPER).generateReport(
                "expression",
                pack(),
                expressionHandoff(true, "실험", "변화"),
                true,
                "expression-id",
                MAPPER.readTree("{\"line_meaning\":\"의미\"}"),
                "analysis-id");

        assertThat(generator.inputs).hasSize(1);
        assertThat(report.at("/source_handoff_ids/analysis").asText()).isEqualTo("analysis-id");
        assertThat(report.at("/source_handoff_ids/expression").asText()).isEqualTo("expression-id");
    }

    @Test
    void parsingStripsFenceAndInjectsAnalysisSourceId() throws Exception {
        ReportEngine engine = new ReportEngine(new RecordingGenerator(), MAPPER);

        JsonNode report = engine.parseReport(
                "```JSON\n" + analysisReport() + "\n```",
                "analysis",
                "analysis-id",
                null);

        assertThat(report.path("source_handoff_id").asText()).isEqualTo("analysis-id");
    }

    @Test
    void parsingRejectsNonObjectAndSchemaViolations() {
        ReportEngine engine = new ReportEngine(new RecordingGenerator(), MAPPER);

        assertThatThrownBy(() -> engine.parseReport("<not-json>", "analysis", "id", null))
                .isInstanceOf(ReportParseError.class)
                .hasMessage("Expecting value: line 1 column 1 (char 0)");
        assertThatThrownBy(() -> engine.parseReport("   ", "analysis", "id", null))
                .isInstanceOf(ReportParseError.class)
                .hasMessage("Expecting value: line 1 column 1 (char 0)");
        assertThatThrownBy(() -> engine.parseReport(
                "[\n  1,\n  <]", "analysis", "id", null))
                .isInstanceOf(ReportParseError.class)
                .hasMessage("Expecting value: line 3 column 3 (char 9)");
        assertThatThrownBy(() -> engine.parseReport("{\n  <}", "analysis", "id", null))
                .isInstanceOf(ReportParseError.class)
                .hasMessage("Expecting property name enclosed in double quotes: "
                        + "line 2 column 3 (char 4)");
        assertThatThrownBy(() -> engine.parseReport("[]", "analysis", "id", null))
                .isInstanceOf(ReportParseError.class)
                .hasMessage("report response is not an object");
        assertThatThrownBy(() -> engine.parseReport(
                "{\"report_type\":\"analysis\",\"extra\":1}", "analysis", "id", null))
                .isInstanceOf(ReportParseError.class);
    }

    @Test
    void blockedResponseIsValidatedWithoutInjectingSourceIds() throws Exception {
        ReportEngine engine = new ReportEngine(new RecordingGenerator(), MAPPER);

        JsonNode report = engine.parseReport(
                "{\"report_type\":\"blocked\",\"reason\":\"confirmed_analysis_handoff_required\"}",
                "analysis",
                "ignored",
                null);

        assertThat(report.fieldNames()).toIterable().containsExactly("report_type", "reason");
    }

    private static JsonNode pack() throws Exception {
        return MAPPER.readTree("""
                {"observations":[{"start_ms":0,"end_ms":100,"label":"멈춘다","confidence":0.9}],
                 "uncertainties":["얼굴은 안 보임"]}
                """);
    }

    private static JsonNode handoff() throws Exception {
        return MAPPER.readTree("{\"blocked_point\":\"대사 의미\"}");
    }

    private static JsonNode expressionHandoff(
            boolean tested, String instruction, String observedChange) throws Exception {
        return MAPPER.readTree("""
                {"experiment":{"tested":%s,"instruction":"%s"},"observed_change":"%s"}
                """.formatted(tested, instruction, observedChange));
    }

    private static String analysisReport() {
        return """
                {"report_type":"analysis","title":"제목","actor_discovery":"발견",
                 "line_meaning":"의미","timing_reason":"이유","target_effect":"효과",
                 "next_take":{"direction":"방향","tested":false},"acting_caution":"주의",
                 "evidence":["근거"],"uncertainties":[]}
                """;
    }

    private static String expressionReport() {
        return """
                {"report_type":"expression","title":"제목","blocked_point":"막힘",
                 "expression_core":"핵심","line_meaning":"의미","timing_reason":"이유",
                 "playable_action":"행동","effective_experiment":{"instruction":"실험","tested":true},
                 "observed_change":"변화","next_take":"다음","acting_trap":"함정",
                 "actor_training":{"title":"훈련","purpose":"목적","duration_minutes":3,
                   "steps":["하나"],"focus":"집중","success_check":"확인","tested":false},
                 "evidence":[],"actor_words":[],"uncertainties":[]}
                """;
    }

    private static final class RecordingGenerator implements TextGenerator {
        private final List<String> responses;
        private final List<String> inputs = new ArrayList<>();

        RecordingGenerator(String... responses) {
            this.responses = List.of(responses);
        }

        @Override
        public GeneratedText generate(String instructions, String input) {
            inputs.add(input);
            return new GeneratedText(responses.get(inputs.size() - 1), new TokenUsage(0, 0, 0));
        }
    }
}
