package com.acttub.actingapi.feature.report.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;

import com.acttub.actingapi.support.FrozenValue;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 보고서 프롬프트와 <b>모델 입력 JSON 의 표기</b>가 바뀌지 않았는지 확인한다.
 *
 * <p>입력 JSON 은 들여쓰기·키 순서·한글 이스케이프까지가 곧 모델이 받는 바이트다. 기대값은
 * {@code frozen/} 의 커밋된 fixture 이고, 왜 커밋해도 되는지는 {@link FrozenValue} 에 있다.
 */
class ReportPromptSnapshotTest {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private static final Map<String, String> SYSTEM_PROMPT_BY_TYPE = Map.of(
            "analysis", "report-system-prompt-analysis.txt",
            "expression", "report-system-prompt-expression.txt");

    @Test
    @DisplayName("보고서 시스템 프롬프트 둘이 동결된 값과 완전히 같다")
    void bothSystemPromptsMatchFrozenValues() {
        SYSTEM_PROMPT_BY_TYPE.forEach((type, fixture) ->
                assertThat(ReportPrompt.select(type))
                        .as("report_type=%s", type)
                        .isEqualTo(FrozenValue.of(fixture)));
    }

    @Test
    @DisplayName("분석 보고서 입력 JSON 의 들여쓰기와 한글 표기가 동결된 값과 같다")
    void analysisInputJsonMatchesFrozenIndentationAndKorean() throws Exception {
        ReportEngine engine = new ReportEngine((instructions, input) -> null, MAPPER);
        JsonNode input = engine.buildReportInput(
                "analysis",
                MAPPER.readTree("""
                    {"scene_summary":"문 앞에서 돌아선 상대를 붙잡는다.",
                     "observations":[{"start_ms":0,"end_ms":100,"what":"멈춘다","quote":"가지 마",
                                      "dimension":"호흡","confidence":0.9,"ignored":"x"}],
                     "uncertainties":["얼굴은 안 보임"],"ignored":"x"}
                    """),
                MAPPER.readTree("{\"blocked_point\":\"대사 의미\"}"),
                true,
                "analysis-id",
                null);

        assertThat(engine.serializeInput(input))
                .isEqualTo(FrozenValue.of("report-input-analysis.txt"));
    }

    @Test
    @DisplayName("표현 보고서 입력 JSON 의 필드 순서와 null 표기가 동결된 값과 같다")
    void expressionInputJsonMatchesFrozenFieldOrderAndNull() throws Exception {
        ReportEngine engine = new ReportEngine((instructions, input) -> null, MAPPER);
        JsonNode handoff = MAPPER.readTree("""
                {"experiment":{"tested":true,"instruction":"한 번 멈춘다"},
                 "observed_change":"말이 선명해졌다"}
                """);
        JsonNode input = engine.buildReportInput(
                "expression",
                MAPPER.readTree("{\"observations\":[],\"uncertainties\":[]}"),
                handoff,
                true,
                "expression-id",
                null);

        assertThat(engine.serializeInput(input))
                .isEqualTo(FrozenValue.of("report-input-expression.txt"));
    }
}
