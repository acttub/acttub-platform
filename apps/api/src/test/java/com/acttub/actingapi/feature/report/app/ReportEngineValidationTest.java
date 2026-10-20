package com.acttub.actingapi.feature.report.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;

/** 성적표 입력 정규화와 모델 출력 검증: 어긋난 곳을 Python 과 같은 문구로 밝혀 거절한다. */
class ReportEngineValidationTest {
    static final ObjectMapper MAPPER = new ObjectMapper();
    final ReportEngine engine = new ReportEngine((instructions, input) -> new GeneratedText("{}", null), MAPPER, new RecordingLlmTelemetry());

    static final String ANALYSIS = """
            {"report_type":"analysis","title":"제목","actor_discovery":"발견",
             "line_meaning":"의미","timing_reason":"이유","target_effect":"효과",
             "next_take":{"direction":"방향","tested":false},"acting_caution":"주의",
             "evidence":["근거"],"uncertainties":[]}
            """;
    static final String EXPRESSION = """
            {"report_type":"expression","title":"제목","blocked_point":"막힘",
             "expression_core":"핵심","line_meaning":"의미","timing_reason":"이유",
             "playable_action":"행동","effective_experiment":{"instruction":"실험","tested":true},
             "observed_change":"변화","next_take":"다음","acting_trap":"함정",
             "actor_training":{"title":"훈련","purpose":"목적","duration_minutes":3,
               "steps":["하나"],"focus":"집중","success_check":"확인","tested":false},
             "evidence":[],"actor_words":[],"uncertainties":[]}
            """;

    String parseError(String raw, String type) {
        try {
            engine.parseReport(raw, type, "handoff-1", null);
        } catch (ReportParseError error) {
            return error.getMessage();
        }
        throw new AssertionError("expected a parse error for " + raw);
    }

    @Test void malformedJsonIsDescribedLikePythonsDecoder() {
        assertThat(parseError("{\"title\" \"x\"}", "analysis")).startsWith("Expecting ':' delimiter: line 1 column ");
        assertThat(parseError("{\"a\":1 \"b\":2}", "analysis")).startsWith("Expecting ',' delimiter: line 1 column ");
        assertThat(parseError("{\"a\":\"\\q\"}", "analysis")).startsWith("Invalid \\escape: line 1 column ");
        assertThat(parseError("{\"a\":\"줄\n바꿈\"}", "analysis")).startsWith("Invalid control character at: line 1 column ");
        assertThat(parseError("{\r\n\"a\" 1}", "analysis")).startsWith("Expecting ':' delimiter: line 2 column ");
        assertThat(parseError("{\n\"a\" 1}", "analysis")).startsWith("Expecting ':' delimiter: line 2 column ");
        assertThat(parseError("[1,2]", "analysis")).isEqualTo("report response is not an object");
        assertThat(parseError("```json\n```", "analysis")).isEqualTo("Expecting value: line 1 column 1 (char 0)");
    }

    @Test void blockedReportsMustNameAKnownReason() {
        assertThat(parseError("{\"report_type\":\"blocked\",\"reason\":\"tired\"}", "analysis")).isEqualTo("invalid blocked report reason");
        JsonNode blocked = engine.parseReport("{\"report_type\":\"blocked\",\"reason\":\"confirmed_expression_handoff_required\"}",
                "expression", "h", null);
        assertThat(blocked.path("reason").asText()).isEqualTo("confirmed_expression_handoff_required");
    }

    ObjectNode analysis() throws Exception { return (ObjectNode) MAPPER.readTree(ANALYSIS); }
    ObjectNode expression() throws Exception { return (ObjectNode) MAPPER.readTree(EXPRESSION); }

    @Test void analysisReportsMustKeepTheirShape() throws Exception {
        assertThat(engine.parseReport(ANALYSIS, "analysis", "h", null).path("source_handoff_id").asText()).isEqualTo("h");
        assertThat(parseError(analysis().put("title", 3).toString(), "analysis")).isEqualTo("title must be a string");
        ObjectNode tested = analysis();
        ((ObjectNode) tested.path("next_take")).put("tested", true);
        assertThat(parseError(tested.toString(), "analysis")).isEqualTo("tested must be false");
        assertThat(parseError(analysis().put("next_take", "방향").toString(), "analysis")).isEqualTo("next_take must be an object");
        assertThat(parseError(analysis().put("evidence", "근거").toString(), "analysis")).isEqualTo("evidence must be an array");
        ObjectNode numbered = analysis();
        numbered.putArray("evidence").add(1);
        assertThat(parseError(numbered.toString(), "analysis")).isEqualTo("evidence item must be a string");
        assertThat(parseError(analysis().put("report_type", "expression").toString(), "analysis")).isEqualTo("report_type must be analysis");
    }

    @Test void expressionReportsMustKeepTheirShape() throws Exception {
        JsonNode valid = engine.parseReport(EXPRESSION, "expression", "e-1", null);
        assertThat(valid.path("source_handoff_ids").toString()).isEqualTo("{\"analysis\":null,\"expression\":\"e-1\"}");
        ObjectNode duration = expression();
        ((ObjectNode) duration.path("actor_training")).put("duration_minutes", "3분");
        assertThat(parseError(duration.toString(), "expression")).isEqualTo("actor_training.duration_minutes must be a number");
        ObjectNode untested = expression();
        ((ObjectNode) untested.path("effective_experiment")).put("tested", false);
        assertThat(parseError(untested.toString(), "expression")).isEqualTo("tested must be true");
        ObjectNode noTested = expression();
        ((ObjectNode) noTested.path("effective_experiment")).put("tested", "true");
        assertThat(parseError(noTested.toString(), "expression")).isEqualTo("tested must be true");
    }

    @Test void theVideoSummaryIsNormalisedOrRejected() throws Exception {
        JsonNode handoff = MAPPER.readTree("{\"blocked_point\":\"대사 의미\"}");
        assertThatThrownBy(() -> engine.buildReportInput("analysis", MAPPER.readTree("[]"), handoff, true, "h", null, null))
                .hasMessage("video_summary must be an object");
        assertThatThrownBy(() -> engine.buildReportInput("analysis",
                MAPPER.readTree("{\"observations\":[{\"start_ms\":0.5,\"end_ms\":1,\"what\":\"멈춘다\",\"confidence\":1}]}"), handoff, true, "h", null, null))
                .hasMessage("start_ms must be an integer");
        assertThatThrownBy(() -> engine.buildReportInput("analysis",
                MAPPER.readTree("{\"observations\":[{\"start_ms\":0,\"end_ms\":1,\"what\":\"멈춘다\",\"confidence\":\"높음\"}]}"), handoff, true, "h", null, null))
                .hasMessage("confidence must be a number");
        assertThatThrownBy(() -> engine.buildReportInput("story", MAPPER.readTree("{}"), handoff, true, "h", null, null))
                .hasMessage("unsupported report type: story");
        JsonNode input = engine.buildReportInput("analysis", MAPPER.readTree(
                "{\"observations\":[{\"start_ms\":0,\"end_ms\":10,\"what\":\"멈춘다\",\"quote\":\"가지 마\",\"dimension\":7,\"confidence\":1}]}"),
                handoff, true, "h", null, null);
        assertThat(input.path("video_summary").toString())
                .isEqualTo("{\"observations\":[{\"start_ms\":0,\"end_ms\":10,\"what\":\"멈춘다\",\"quote\":\"가지 마\",\"confidence\":1.0}],\"uncertainties\":[]}");
    }

    @Test void unavailableHandoffsProduceNoInputAndAnUnavailableAnalysisIsDropped() throws Exception {
        assertThat(engine.buildReportInput("analysis", MAPPER.readTree("{}"),
                MAPPER.readTree("{\"completion_level\":\"unavailable\"}"), true, "h", null, null)).isNull();
        JsonNode expressionHandoff = MAPPER.readTree("{\"experiment\":{\"tested\":true,\"instruction\":\"끝을 짧게\"},\"observed_change\":\"덜 애원\"}");
        JsonNode input = engine.buildReportInput("expression", MAPPER.readTree("{}"), expressionHandoff, true, "e",
                MAPPER.readTree("{\"completion_level\":\"unavailable\"}"), null);
        assertThat(input.path("analysis_handoff").isNull()).isTrue();
        JsonNode noExperiment = MAPPER.readTree("{\"experiment\":\"끝을 짧게\",\"observed_change\":\"덜 애원\"}");
        assertThat(engine.buildReportInput("expression", MAPPER.readTree("{}"), noExperiment, true, "e", null, null)).isNull();
        assertThat(engine.serializeInput(MAPPER.readTree("{\"a\":{},\"b\":[]}"))).isEqualTo("{\n  \"a\": {},\n  \"b\": []\n}");
    }

    @Test void missingOrWronglyTypedSummaryValuesAreNamed() throws Exception {
        JsonNode handoff = MAPPER.readTree("{\"blocked_point\":\"대사 의미\"}");
        assertThatThrownBy(() -> engine.buildReportInput("analysis", null, handoff, true, "h", null, null))
                .hasMessage("video_summary must be an object");
        assertThatThrownBy(() -> engine.buildReportInput("analysis",
                MAPPER.readTree("{\"observations\":[{\"end_ms\":1,\"what\":\"멈춘다\",\"confidence\":1}]}"), handoff, true, "h", null, null))
                .hasMessage("start_ms must be an integer");
        assertThatThrownBy(() -> engine.buildReportInput("analysis",
                MAPPER.readTree("{\"observations\":[{\"start_ms\":\"0\",\"end_ms\":1,\"what\":\"멈춘다\",\"confidence\":1}]}"), handoff, true, "h", null, null))
                .hasMessage("start_ms must be an integer");
        assertThatThrownBy(() -> engine.buildReportInput("analysis",
                MAPPER.readTree("{\"observations\":[{\"start_ms\":0,\"end_ms\":1,\"what\":\"멈춘다\"}]}"), handoff, true, "h", null, null))
                .hasMessage("confidence must be a number");
        assertThat(engine.buildReportInput("analysis", MAPPER.readTree("{}"), MAPPER.readTree("[]"), true, "h", null, null)).isNull();
    }

    @Test void anExpressionHandoffNeedsATestedExperimentAndAnObservedChange() throws Exception {
        for (String handoff : java.util.List.of(
                "{\"experiment\":{\"tested\":\"yes\",\"instruction\":\"끝을 짧게\"},\"observed_change\":\"덜 애원\"}",
                "{\"experiment\":{\"tested\":true,\"instruction\":\"끝을 짧게\"},\"observed_change\":3}",
                "{\"experiment\":{\"tested\":true,\"instruction\":\"끝을 짧게\"}}")) {
            assertThat(engine.buildReportInput("expression", MAPPER.readTree("{}"), MAPPER.readTree(handoff), true, "e", null, null))
                    .as(handoff).isNull();
        }
    }
}
