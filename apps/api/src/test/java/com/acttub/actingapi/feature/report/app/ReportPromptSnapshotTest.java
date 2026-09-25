package com.acttub.actingapi.feature.report.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import com.acttub.actingapi.support.FrozenValue;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
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
        ReportEngine engine = new ReportEngine((instructions, input) -> null, MAPPER, new RecordingLlmTelemetry());
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
        ReportEngine engine = new ReportEngine((instructions, input) -> null, MAPPER, new RecordingLlmTelemetry());
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

    // ---- account.profile: 노트가 프로필을 읽는다 ----

    private static final ReportProfile.ActorProfile PROFILE = new ReportProfile.ActorProfile(
            "김배우", "여성", 25, List.of("매체(TV·영화)", "무대(연극·뮤지컬)"), "1–3년", "전문 배우");

    /**
     * 프로필은 handoff 밖, 입력의 <b>최상위</b>에 실린다. 앞부분은 프로필이 없던 때의 고정값과 글자 하나
     * 다르지 않다 — 새 고정값은 기존 것 끝에 {@code actor_profile} 하나를 더한 것이다.
     */
    @Test
    @DisplayName("account.profile: 완성된 프로필이 있는 분석·표현 입력 JSON 이 동결된 값과 같다")
    void inputJsonWithAnActorProfileMatchesFrozenValues() throws Exception {
        ReportEngine engine = new ReportEngine((instructions, input) -> null, MAPPER, new RecordingLlmTelemetry());

        String analysis = engine.serializeInput(engine.buildReportInput(
                "analysis", analysisPack(), MAPPER.readTree("{\"blocked_point\":\"대사 의미\"}"),
                true, "analysis-id", null, PROFILE));
        String expression = engine.serializeInput(engine.buildReportInput(
                "expression", MAPPER.readTree("{\"observations\":[],\"uncertainties\":[]}"), expressionHandoff(),
                true, "expression-id", null, PROFILE));

        assertThat(analysis).isEqualTo(FrozenValue.of("report-input-analysis-actor-profile.txt"));
        assertThat(expression).isEqualTo(FrozenValue.of("report-input-expression-actor-profile.txt"));
        // 프로필은 최상위에만 있다. 확정된 handoff 로 복사하지 않는다.
        assertThat(MAPPER.readTree(analysis).path("confirmed_handoff").has("actor_profile")).isFalse();
        assertThat(MAPPER.readTree(expression).path("expression_handoff").has("actor_profile")).isFalse();
    }

    @Test
    @DisplayName("account.profile: 프로필이 없으면 입력 JSON 이 바이트 단위로 전과 같다")
    void withoutAProfileTheInputJsonIsByteForByteTheSame() throws Exception {
        ReportEngine engine = new ReportEngine((instructions, input) -> null, MAPPER, new RecordingLlmTelemetry());

        assertThat(engine.serializeInput(engine.buildReportInput(
                "analysis", analysisPack(), MAPPER.readTree("{\"blocked_point\":\"대사 의미\"}"),
                true, "analysis-id", null, null)))
                .isEqualTo(FrozenValue.of("report-input-analysis.txt"));
        assertThat(engine.serializeInput(engine.buildReportInput(
                "expression", MAPPER.readTree("{\"observations\":[],\"uncertainties\":[]}"), expressionHandoff(),
                true, "expression-id", null, null)))
                .isEqualTo(FrozenValue.of("report-input-expression.txt"));
    }

    /**
     * 시스템 프롬프트 본문은 조건 없이 바꾸지 않는다. 프로필을 어떻게 쓸지의 지시는 프로필이 실린 호출에만
     * 뒤에 붙는다 — 프로필이 없는 배우의 노트는 프롬프트도 입력도 전과 같다.
     */
    @Test
    @DisplayName("account.profile: 활용 지시는 프로필이 있는 노트 생성에만 붙고, 없으면 시스템 프롬프트가 동결된 값 그대로다")
    void usageInstructionIsAppendedOnlyWhenTheActorHasACompleteProfile() throws Exception {
        java.util.UUID member = java.util.UUID.randomUUID();
        java.util.UUID guest = java.util.UUID.randomUUID();
        java.util.List<String[]> calls = new java.util.ArrayList<>();
        ReportEngine engine = new ReportEngine((instructions, input) -> {
            calls.add(new String[] {instructions, input});
            return new com.acttub.actingapi.integration.llm.GeneratedText("""
                    {"report_type":"analysis","title":"제목","actor_discovery":"발견",
                     "line_meaning":"의미","timing_reason":"이유","target_effect":"효과",
                     "next_take":{"direction":"방향","tested":false},"acting_caution":"주의",
                     "evidence":["근거"],"uncertainties":[]}
                    """, null, "model");
        }, MAPPER, new RecordingLlmTelemetry(), userId -> member.equals(userId) ? PROFILE : null);
        JsonNode handoff = MAPPER.readTree("{\"blocked_point\":\"대사 의미\"}");

        JsonNode withProfile = engine.generateReport(
                "analysis", analysisPack(), handoff, true, "analysis-id", null, null, null, member);
        engine.generateReport("analysis", analysisPack(), handoff, true, "analysis-id", null, null, null, guest);
        engine.generateReport("analysis", analysisPack(), handoff, true, "analysis-id", null, null);

        assertThat(calls.get(0)[0]).isEqualTo(
                FrozenValue.of("report-system-prompt-analysis.txt") + ReportEngine.ACTOR_PROFILE_INSTRUCTION);
        assertThat(calls.get(0)[1]).isEqualTo(FrozenValue.of("report-input-analysis-actor-profile.txt"));
        for (int absent : List.of(1, 2)) {
            assertThat(calls.get(absent)[0]).isEqualTo(FrozenValue.of("report-system-prompt-analysis.txt"));
            assertThat(calls.get(absent)[1]).isEqualTo(FrozenValue.of("report-input-analysis.txt"));
        }
        // 프로필은 모델 입력일 뿐이다. 만든 노트에 남기지 않는다.
        assertThat(withProfile.toString()).doesNotContain("김배우", "1–3년", "actor_profile");
    }

    private static JsonNode analysisPack() throws Exception {
        return MAPPER.readTree("""
                {"scene_summary":"문 앞에서 돌아선 상대를 붙잡는다.",
                 "observations":[{"start_ms":0,"end_ms":100,"what":"멈춘다","quote":"가지 마",
                                  "dimension":"호흡","confidence":0.9,"ignored":"x"}],
                 "uncertainties":["얼굴은 안 보임"],"ignored":"x"}
                """);
    }

    private static JsonNode expressionHandoff() throws Exception {
        return MAPPER.readTree("""
                {"experiment":{"tested":true,"instruction":"한 번 멈춘다"},
                 "observed_change":"말이 선명해졌다"}
                """);
    }
}
