package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.TextValidator;
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

    /** 두 줄짜리 받아쓴 대사 — 칸이 여러 줄을 목록으로 적는지 보이려고 둘을 쓴다. */
    private static final List<String> TRANSCRIPTS = List.of("가지 마", "제발");

    private static final Map<String, String> SYSTEM_PROMPT_BY_KIND = Map.of(
            "분석", "coach-system-prompt-analysis.txt",
            "표현", "coach-system-prompt-expression.txt",
            "그 외", "coach-system-prompt-other.txt");

    /** 7번째부터의 안전 문구. 그 외는 분석 갈래라 분석 문장을 받는다. */
    private static final Map<String, String> CLOSING_SAFE_TEMPLATE_BY_KIND = Map.of(
            "분석", "coach-safe-template-closing-analysis.txt",
            "그 외", "coach-safe-template-closing-analysis.txt",
            "표현", "coach-safe-template-closing-expression.txt");

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
        assertThat(CoachPrompt.buildChat(expressionSession(List.of()), "이번에는 멈춰봤어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt.txt"));
    }

    /**
     * 받아쓴 대사 칸은 갈래로 갈리지 않는다 — 표현·그 외로 시작한 연습의 코치도 대사를
     * 인용해 말해야 한다. 예전에는 "분석" 세션에만 넣었다.
     */
    @Test
    @DisplayName("표현 갈래에도 받아쓴 대사가 있으면 그 칸이 들어간다")
    void expressionSessionWithTranscriptsMatchesFrozenValue() throws Exception {
        CoachSessionSnapshot expression = expressionSession(TRANSCRIPTS);
        assertThat(CoachPrompt.buildChat(expression, "이번에는 멈춰봤어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt-expression-transcripts.txt"));
    }

    /**
     * 그 외 갈래는 v2 본문을 쓰되 표현 전용 칸 없이, 받아쓴 대사 칸은 들어간다. 갈래가
     * {@code 그 외} 이므로 막힘 미특정 블록이 붙는다 — 코치가 막힘을 지어내지 않고 영상에서
     * 확인된 것으로 대화를 연다.
     */
    @Test
    @DisplayName("그 외 갈래에는 막힘 미특정 블록이 붙고 받아쓴 대사 칸도 들어간다")
    void otherSessionWithTranscriptsMatchesFrozenValue() throws Exception {
        assertThat(CoachPrompt.buildChat(otherSession(), "잘 모르겠어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt-other-transcripts.txt"));
    }

    /**
     * 장면도 막힘도 건너뛴 세션 — 웹·앱 어느 쪽이든 둘 다 건너뛰면 이렇게 온다. 두 블록이
     * 장면·막힘 순으로 나란히 붙는다.
     */
    @Test
    @DisplayName("장면도 막힘도 건너뛴 그 외 갈래에는 두 블록이 장면·막힘 순으로 붙는다")
    void otherSessionWithBlankSceneMatchesFrozenValue() throws Exception {
        assertThat(CoachPrompt.buildChat(withScene(otherSession(), "", "", ""), "잘 모르겠어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt-other-blank-scene.txt"));
    }

    /**
     * 빈 칸은 <b>줄 자체를 만들지 않는다</b>(ADR-021). 셋이 모두 비면 장면 맥락 미입력
     * 블록이 붙어 코치가 첫 한두 응답에서 영상 근거로 장면을 묻는다(ADR-021 개정). {@code 그 외}
     * 하위 갈래는 "특정하지 않음" 으로 적는다 — 직접 고른 사람과 안 고른 사람을 서버가 구분할
     * 수 없는데 그 표현은 <b>양쪽 모두에게 참</b>이다. 같은 이유로 갈래가 분석이고 하위 갈래만
     * {@code 그 외} 인 이 세션에는 막힘 미특정 블록이 붙지 않는다.
     */
    @Test
    @DisplayName("세 칸 모두 빈 장면에는 미입력 블록이 붙고, 하위 갈래만 '그 외' 면 막힘 미특정 블록은 붙지 않는다")
    void blankSceneChatPromptMatchesFrozenValue() {
        assertThat(CoachPrompt.buildChat(blankSceneSession("", "", ""), "잘 모르겠어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt-blank-scene.txt"));
    }

    /** 판정은 {@code isBlank()} 다 — 웹의 {@code .trim()} 에 기대지 않는다. */
    @Test
    @DisplayName("공백만 든 칸도 빈 칸과 같은 프롬프트를 낸다")
    void whitespaceOnlySceneIsTreatedAsBlank() {
        assertThat(CoachPrompt.buildChat(blankSceneSession(" ", "\t", "\n"), "잘 모르겠어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt-blank-scene.txt"));
    }

    /**
     * 장면을 <b>적어 온</b> 배우의 프롬프트도 바뀐 자리다 — 지금까지는 상세가 비면
     * {@code - 배우가 쓴 상세: } 가 빈 채로 들어갔다.
     */
    @Test
    @DisplayName("장면은 다 적고 상세만 빈 경우 상세 줄만 빠진다")
    void blankDetailAloneDropsOnlyItsLine() {
        CoachSessionSnapshot blankDetail = sceneSession(
                "연습실", "지원자", "담담하게 말한다", "대사 분석", "");
        assertThat(CoachPrompt.buildChat(blankDetail, "잘 모르겠어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt-blank-detail.txt"));
    }

    /** 일부만 비면 그 줄만 빠진다 — 부재를 말하지 않고 장면 맥락 미입력 블록도 붙지 않는다. */
    @Test
    @DisplayName("일부만 빈 장면은 그 줄만 빠지고 장면 맥락 미입력 블록이 붙지 않는다")
    void partiallyBlankSceneChatPromptMatchesFrozenValue() {
        CoachSessionSnapshot partial = sceneSession(
                "", "", "담담하게 말한다", "대사 분석", "이유를 모르겠다");
        assertThat(CoachPrompt.buildChat(partial, "잘 모르겠어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt-partial-scene.txt"));
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
        for (int turnNumber = 1; turnNumber <= 6; turnNumber++) {
            for (String kind : CLOSING_SAFE_TEMPLATE_BY_KIND.keySet()) {
                assertThat(CoachPrompt.safeTemplate(turnNumber, kind))
                        .as("blockage_kind=%s %d번째 안전 문구", kind, turnNumber)
                        .isEqualTo(FrozenValue.of("coach-safe-template.txt"));
            }
        }
    }

    /**
     * 7번째부터의 안전 문구는 질문이 아니라 정리 청유다 — 응답 번호와 갈래마다 어느 문장이
     * 가는지를 동결한다. 예산(8)을 넘긴 9번째도 같은 문장이다.
     */
    @Test
    @DisplayName("7번째부터의 안전 문구가 갈래별 정리 청유 동결값과 완전히 같다")
    void closingSafeTemplatesMatchFrozenValues() {
        for (int turnNumber : List.of(7, 8, 9)) {
            CLOSING_SAFE_TEMPLATE_BY_KIND.forEach((kind, fixture) ->
                    assertThat(CoachPrompt.safeTemplate(turnNumber, kind))
                            .as("blockage_kind=%s %d번째 안전 문구", kind, turnNumber)
                            .isEqualTo(FrozenValue.of(fixture)));
        }
    }

    /** 안전 문구는 검증을 건너뛰고 나간다 — 그래서 문구 자신이 검증을 통과해야 한다. */
    @Test
    @DisplayName("안전 문구 세 벌 모두 서버 검증에 걸리지 않는다")
    void safeTemplatesPassTurnValidation() {
        for (int turnNumber : List.of(6, 7)) {
            for (String kind : List.of("분석", "표현")) {
                assertThat(TextValidator.validateTurn(
                        CoachPrompt.safeTemplate(turnNumber, kind), true).failures())
                        .as("blockage_kind=%s %d번째 안전 문구", kind, turnNumber)
                        .isEmpty();
            }
        }
    }

    /** 응답 번호는 코치 turn 수 + 1 이다 — 프롬프트의 "현재 응답: N번째" 와 같은 셈이다. */
    @Test
    @DisplayName("응답 번호는 코치 turn 수에 1을 더한 값이다")
    void turnNumberCountsAiTurnsPlusOne() throws Exception {
        assertThat(CoachPrompt.turnNumber(otherSession())).isEqualTo(1);
        assertThat(CoachPrompt.turnNumber(expressionSession(List.of()))).isEqualTo(2);
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

    private static CoachSessionSnapshot expressionSession(List<String> transcripts)
            throws Exception {
        JsonNode handoff = OBJECT_MAPPER.readTree("""
                {"blocked_point":"말의 이유","line_meaning":"떠나지 말라는 뜻",
                 "timing_reason":"상대가 돌아섰기 때문","target_effect":"멈춰 세우기",
                 "scene_evidence":["상대가 돌아선다"],"actor_words":["붙잡고 싶다"]}
                """);
        return snapshot(
                observationPack(), "표현", "속도", "자꾸 빨라진다", transcripts,
                "앞 대사를 급히 받는다", handoff,
                List.of(
                        new CoachTurnSnapshot("actor", "이전 질문"),
                        new CoachTurnSnapshot("ai", "이전 답변")));
    }

    /** 웹·앱이 막힘 선택을 건너뛰면 보내는 값 — 갈래·하위 갈래 모두 {@code 그 외}, 상세 없음. */
    private static CoachSessionSnapshot otherSession() throws Exception {
        return snapshot(
                observationPack(), "그 외", "그 외", "", TRANSCRIPTS,
                "", null, List.of());
    }

    private static JsonNode observationPack() throws Exception {
        return OBJECT_MAPPER.readTree("""
                {"observations":[{"start_ms":0,"end_ms":93000,"label":"멈춘 뒤 말한다","confidence":1.0}],
                 "uncertainties":["얼굴은 확인되지 않음"]}
                """);
    }

    private static CoachSessionSnapshot blankSceneSession(
            String situation, String characterContext, String goal) {
        return sceneSession(situation, characterContext, goal, "그 외", "");
    }

    /** 장면 세 칸과 하위 갈래·상세만 갈아끼운 분석 세션. 나머지는 {@link #snapshot} 기본값이다. */
    private static CoachSessionSnapshot sceneSession(
            String situation,
            String characterContext,
            String goal,
            String subBranch,
            String blockageDetail) {
        return withScene(
                snapshot(null, "분석", subBranch, blockageDetail, List.of("가지 마"), "", null, List.of()),
                situation, characterContext, goal);
    }

    /** 장면 세 칸만 갈아끼운 사본. */
    private static CoachSessionSnapshot withScene(
            CoachSessionSnapshot source,
            String situation,
            String characterContext,
            String goal) {
        return new CoachSessionSnapshot(
                source.sessionId(), source.practiceSessionId(), source.summaryId(),
                source.userId(), source.observationPack(), situation, characterContext, goal,
                source.durationMs(), source.blockageKind(), source.subBranch(),
                source.blockageDetail(), source.transcripts(), source.conversationSummary(),
                source.analysisHandoff(), source.status(), source.closeReason(), source.turns());
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
