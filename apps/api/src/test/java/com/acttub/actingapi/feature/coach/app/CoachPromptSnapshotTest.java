package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.support.FrozenValue;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * 코치 프롬프트가 <b>한 글자도 바뀌지 않았는지</b> 확인한다. 기대값은 {@code frozen/} 의
 * 커밋된 fixture 이고, 왜 커밋해도 되는지는 {@link FrozenValue} 에 있다.
 */
class CoachPromptSnapshotTest {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    private static final Map<String, String> SYSTEM_PROMPT_BY_KIND = Map.of(
            "분석", "coach-system-prompt-analysis.txt",
            "표현", "coach-system-prompt-expression.txt",
            "그 외", "coach-system-prompt-other.txt");

    @Test
    @DisplayName("select 세 갈래가 동결된 값과 완전히 같다")
    void selectedPromptsMatchFrozenValues() {
        SYSTEM_PROMPT_BY_KIND.forEach((kind, fixture) ->
                assertThat(CoachPrompt.select(kind))
                        .as("blockage_kind=%s 시스템 프롬프트", kind)
                        .isEqualTo(FrozenValue.of(fixture)));
    }

    @Test
    @DisplayName("buildChat 의 직렬화 문자열이 동결된 값과 완전히 같다")
    void chatPromptMatchesFrozenValue() throws Exception {
        assertThat(CoachPrompt.buildChat(expressionSession(), "이번에는 멈춰봤어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt.txt"));
    }

    @Test
    @DisplayName("buildRegeneration 과 safeTemplate 가 동결된 값과 완전히 같다")
    void regenerationAndSafeTemplateMatchFrozenValues() {
        assertThat(CoachPrompt.buildRegeneration(
                analysisSession(),
                "잘 모르겠어요",
                "{\"message\":\"점수\"}",
                List.of("금지어가 노출됐습니다: 점수", "응답에 시각이 들어 있습니다.")))
                .isEqualTo(FrozenValue.of("coach-regeneration-prompt.txt"));
        assertThat(CoachPrompt.safeTemplate())
                .isEqualTo(FrozenValue.of("coach-safe-template.txt"));
    }

    /**
     * 지시문 텍스트만 대조하면 부착 <b>조건</b>이 틀려도 초록이 된다. 실제로 그랬다 --
     * 옛 구현이 {@code contains("끝")} 이라 "이제 끝"·"끝까지 해볼게요" 같은 정상 답변에도
     * 지시문을 붙였는데, 기대값을 무조건 이어붙여 만든 탓에 통과했다. 그래서 동결된 값은
     * <b>판정을 통과시킨 결과</b>다 — 열 갈래 중 어느 것에 지시문이 붙는지가 그 안에 있다.
     */
    @Test
    @DisplayName("마무리 요청 판정과 지시문이 동결된 값과 완전히 같다")
    void closingInstructionMatchesFrozenValue() {
        List<String> cases = List.of(
                "이제 끝", "끝", "그만", "종료", "여기까지",
                "끝까지 해볼게요", "여기서 그만할게", "안 그만할래요", "그렇그만", "이제 그만");

        List<String> actual = cases.stream().map(CoachEngine::messageForGeneration).toList();

        assertThat(String.join("\n---\n", actual))
                .isEqualTo(FrozenValue.of("coach-closing-instruction.txt"));
    }

    private static CoachSessionSnapshot expressionSession() throws Exception {
        JsonNode observationPack = OBJECT_MAPPER.readTree("""
                {"observations":[{"start_ms":0,"end_ms":93000,"label":"멈춘 뒤 말한다","confidence":1.0}],
                 "uncertainties":["얼굴은 확인되지 않음"]}
                """);
        JsonNode handoff = OBJECT_MAPPER.readTree("""
                {"blocked_point":"말의 이유","line_meaning":"떠나지 말라는 뜻",
                 "timing_reason":"상대가 돌아섰기 때문","target_effect":"멈춰 세우기",
                 "scene_evidence":["상대가 돌아선다"],"actor_words":["붙잡고 싶다"]}
                """);
        return snapshot(
                observationPack, "표현", "속도", "자꾸 빨라진다", List.of(),
                "앞 대사를 급히 받는다", handoff,
                List.of(
                        new CoachTurnSnapshot("actor", "이전 질문"),
                        new CoachTurnSnapshot("ai", "이전 답변")));
    }

    private static CoachSessionSnapshot analysisSession() {
        return snapshot(
                null, "분석", "의미", "이유를 모르겠다", List.of("가지 마"), "", null, List.of());
    }

    private static CoachSessionSnapshot snapshot(
            JsonNode observationPack,
            String blockageKind,
            String subBranch,
            String blockageDetail,
            List<String> transcripts,
            String conversationSummary,
            JsonNode analysisHandoff,
            List<CoachTurnSnapshot> turns) {
        return new CoachSessionSnapshot(
                UUID.fromString("00000000-0000-0000-0000-000000000001"),
                UUID.fromString("00000000-0000-0000-0000-000000000002"),
                null,
                UUID.fromString("00000000-0000-0000-0000-000000000003"),
                observationPack,
                "연습실",
                "지원자",
                "담담하게 말한다",
                93000,
                blockageKind,
                subBranch,
                blockageDetail,
                transcripts,
                conversationSummary,
                analysisHandoff,
                "open",
                "",
                turns);
    }
}
