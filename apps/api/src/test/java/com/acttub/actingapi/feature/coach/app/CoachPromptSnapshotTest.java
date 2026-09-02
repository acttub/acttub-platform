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

    /** 두 줄짜리 받아쓴 대사 — 칸이 여러 줄을 목록으로 적는지 보이려고 둘을 쓴다. */
    private static final List<String> TRANSCRIPTS = List.of("가지 마", "제발");

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

    /** 그 외 갈래는 v2 본문을 쓰되 표현 전용 칸 없이, 받아쓴 대사 칸은 들어간다. */
    @Test
    @DisplayName("그 외 갈래에도 받아쓴 대사가 있으면 그 칸이 들어간다")
    void otherSessionWithTranscriptsMatchesFrozenValue() throws Exception {
        assertThat(CoachPrompt.buildChat(otherSession(), "잘 모르겠어요"))
                .isEqualTo(FrozenValue.of("coach-chat-prompt-other-transcripts.txt"));
    }

    /**
     * 빈 칸은 <b>줄 자체를 만들지 않는다</b>(ADR-021). 셋이 모두 비면 장면 맥락 미입력
     * 블록이 붙어 코치가 첫 한두 응답에서 영상 근거로 장면을 묻는다(ADR-021 개정). {@code 그 외}
     * 하위 갈래는 "특정하지 않음" 으로 적는다 — 직접 고른 사람과 안 고른 사람을 서버가 구분할
     * 수 없는데 그 표현은 <b>양쪽 모두에게 참</b>이다.
     */
    @Test
    @DisplayName("장면 세 칸이 모두 비면 장면 맥락 미입력 블록이 붙고 '그 외' 는 특정하지 않음이 된다")
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

    /** 앱이 막힘 선택을 건너뛰면 보내는 값 — 갈래·하위 갈래 모두 {@code 그 외}, 상세 없음. */
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
        CoachSessionSnapshot source = snapshot(
                null, "분석", subBranch, blockageDetail, List.of("가지 마"), "", null, List.of());
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
