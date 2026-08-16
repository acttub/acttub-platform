package com.acttub.actingapi.platform.harness;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;

import com.acttub.actingapi.report.ReportPrompt;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class ContractTextGeneratorTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final String FIXTURE = Path.of(
            "../../tools/contract-harness/contract_harness/fixtures/llm.json")
            .toString();

    @Test
    void resolvesAnalysisHandoffPlaceholderAndTracksCoachBudget() throws Exception {
        ContractTextGenerator generator = new ContractTextGenerator(MAPPER, FIXTURE);

        String response = generator.generate("coach", "[[coach:complete]]").text();
        JsonNode parsed = MAPPER.readTree(response);

        assertThat(parsed.at("/status").asText()).isEqualTo("complete");
        assertThat(parsed.at("/handoff/handoff_type").asText()).isEqualTo("analysis");
        assertThat(generator.coachState().get("calls")).isEqualTo(1);
        assertThat(generator.coachState().get("remaining")).isEqualTo(23);
        assertThat(generator.coachState().get("budget")).isEqualTo(24);
    }

    @Test
    void searchesWholeReportInputForMarkerAndReturnsRawNonJsonFixture() {
        ContractTextGenerator generator = new ContractTextGenerator(MAPPER, FIXTURE);

        String response = generator.generate(
                ReportPrompt.select("analysis"),
                "coach_summary contains [[report:parse_error]] here").text();

        assertThat(response).isEqualTo("<<이건 JSON 이 아니다>>");
        assertThat(generator.reportState().get("calls")).isEqualTo(1);
        assertThat(generator.coachState().get("calls")).isEqualTo(0);
    }

    @Test
    void releasedGateCountsBlockEntryWithoutWaitingAndCanBeRearmed() {
        ContractTextGenerator generator = new ContractTextGenerator(MAPPER, FIXTURE);
        generator.release("coach_generate");

        generator.generate("coach", "question [[stub:block]]");

        assertThat(generator.coachState().get("blocked")).isEqualTo(1);
        assertThat(generator.coachState().get("in_block")).isEqualTo(false);
        assertThat(generator.coachState().get("in_block_count")).isEqualTo(0);
        assertThat(generator.coachState().get("timed_out")).isEqualTo(0);
        generator.rearm("coach_generate");
    }
}
