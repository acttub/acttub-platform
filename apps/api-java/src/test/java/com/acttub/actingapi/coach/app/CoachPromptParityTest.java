package com.acttub.actingapi.coach.app;

import com.acttub.actingapi.coach.domain.CoachTurnSnapshot;
import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIf;

class CoachPromptParityTest {

    private static final int TIMEOUT_SECONDS = 120;
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @Test
    @EnabledIf("pythonIsAvailable")
    @DisplayName("select_prompt 세 갈래가 파이썬 원본과 완전히 같다")
    void selectedPromptsMatchPythonSource() {
        for (String kind : List.of("분석", "표현", "그 외")) {
            String expected = readPythonValue(
                    "from acting_agent.prompt import select_prompt; value = select_prompt(%s)"
                            .formatted(pythonLiteral(kind)));

            assertThat(CoachPrompt.select(kind))
                    .as("blockage_kind=%s 시스템 프롬프트", kind)
                    .isEqualTo(expected);
        }
    }

    @Test
    @EnabledIf("pythonIsAvailable")
    @DisplayName("build_chat_prompt 의 직렬화 문자열이 파이썬 원본과 완전히 같다")
    void chatPromptMatchesPythonSource() throws Exception {
        String expected = readPythonValue("""
                from acting_agent.prompt import build_chat_prompt
                from acting_agent.schema import CoachSession, CoachTurn
                from acting_agent.summary_schema import ActorMaterial, ObservationItem, ObservationPack
                session = CoachSession(
                    session_id="00000000-0000-0000-0000-000000000001",
                    practice_session_id="00000000-0000-0000-0000-000000000002",
                    summary_id=None,
                    observation_pack=ObservationPack(
                        observations=[ObservationItem(start_ms=0, end_ms=93000, label="멈춘 뒤 말한다", confidence=1.0)],
                        uncertainties=["얼굴은 확인되지 않음"],
                    ),
                    actor=ActorMaterial(
                        situation="연습실", character="지원자", goal="담담하게 말한다",
                        blockage_kind="표현", blockage_detail="자꾸 빨라진다", duration_ms=93000,
                    ),
                    blockage_kind="표현", sub_branch="속도", blockage_detail="자꾸 빨라진다",
                    conversation_summary="앞 대사를 급히 받는다",
                    analysis_handoff={
                        "blocked_point":"말의 이유", "line_meaning":"떠나지 말라는 뜻",
                        "timing_reason":"상대가 돌아섰기 때문", "target_effect":"멈춰 세우기",
                        "scene_evidence":["상대가 돌아선다"], "actor_words":["붙잡고 싶다"],
                    },
                    turns=[CoachTurn(role="actor", text="이전 질문"), CoachTurn(role="ai", text="이전 답변")],
                )
                value = build_chat_prompt(session, "이번에는 멈춰봤어요")
                """);

        assertThat(CoachPrompt.buildChat(expressionSession(), "이번에는 멈춰봤어요"))
                .isEqualTo(expected);
    }

    @Test
    @EnabledIf("pythonIsAvailable")
    @DisplayName("build_regeneration_prompt 와 safe_template 가 파이썬 원본과 완전히 같다")
    void regenerationAndSafeTemplateMatchPythonSource() throws Exception {
        String sessionSetup = """
                from acting_agent.schema import CoachSession
                from acting_agent.summary_schema import ActorMaterial
                session = CoachSession(
                    session_id="00000000-0000-0000-0000-000000000001",
                    practice_session_id="00000000-0000-0000-0000-000000000002",
                    actor=ActorMaterial(
                        situation="연습실", character="지원자", goal="담담하게 말한다",
                        blockage_kind="분석", blockage_detail="이유를 모르겠다", duration_ms=93000,
                    ),
                    blockage_kind="분석", sub_branch="의미", blockage_detail="이유를 모르겠다",
                    transcripts=["가지 마"],
                )
                """;
        String expectedRegeneration = readPythonValue("""
                from acting_agent.prompt import build_regeneration_prompt
                %s
                value = build_regeneration_prompt(
                    session, "잘 모르겠어요", '{"message":"점수"}',
                    ["금지어가 노출됐습니다: 점수", "응답에 시각이 들어 있습니다."],
                )
                """.formatted(sessionSetup));
        String expectedSafe = readPythonValue(
                "from acting_agent.prompt import safe_template; value = safe_template()");

        assertThat(CoachPrompt.buildRegeneration(
                analysisSession(),
                "잘 모르겠어요",
                "{\"message\":\"점수\"}",
                List.of("금지어가 노출됐습니다: 점수", "응답에 시각이 들어 있습니다.")))
                .isEqualTo(expectedRegeneration);
        assertThat(CoachPrompt.safeTemplate()).isEqualTo(expectedSafe);
    }

    /**
     * 지시문 텍스트만 대조하면 부착 **조건**이 틀려도 초록이 된다. 실제로 그랬다 --
     * 옛 구현이 `contains("끝")` 이라 "이제 끝"·"끝까지 해볼게요" 같은 정상 답변에도
     * 지시문을 붙였는데, 파이썬을 무조건 이어붙여 기대값을 만든 탓에 통과했다.
     * 그래서 파이썬의 `is_closing` 을 그대로 통과시킨 결과와 대조한다.
     */
    @Test
    @EnabledIf("pythonIsAvailable")
    @DisplayName("마무리 요청 판정과 지시문이 파이썬 원본과 완전히 같다")
    void closingInstructionMatchesPythonSource() {
        List<String> cases = List.of(
                "이제 끝", "끝", "그만", "종료", "여기까지",
                "끝까지 해볼게요", "여기서 그만할게", "안 그만할래요", "그렇그만", "이제 그만");
        String expected = readPythonValue("""
                from acting_agent.engine import is_closing, _CLOSING_TURN_INSTRUCTION
                cases = ["이제 끝", "끝", "그만", "종료", "여기까지",
                         "끝까지 해볼게요", "여기서 그만할게", "안 그만할래요", "그렇그만", "이제 그만"]
                value = "\\n---\\n".join(
                    c + _CLOSING_TURN_INSTRUCTION if is_closing(c) else c for c in cases
                )
                """);

        List<String> actual = cases.stream().map(CoachEngine::messageForGeneration).toList();
        assertThat(String.join("\n---\n", actual)).isEqualTo(expected);
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

    private static String readPythonValue(String snippet) {
        String program = """
                import sys
                sys.path.insert(0, "acting-agent/src")
                sys.path.insert(0, "acting-llm/src")
                %s
                sys.stdout.write(value)
                """.formatted(snippet);
        ProcessBuilder builder = new ProcessBuilder(pythonExecutable().toString(), "-c", program);
        builder.directory(apiRoot().toFile());
        builder.environment().put("PYTHONIOENCODING", "utf-8");
        try {
            Process process = builder.start();
            String out;
            String err;
            try (var in = process.getInputStream(); var errStream = process.getErrorStream()) {
                out = new String(in.readAllBytes(), StandardCharsets.UTF_8);
                err = new String(errStream.readAllBytes(), StandardCharsets.UTF_8);
            }
            if (!process.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
                process.destroyForcibly();
                throw new IllegalStateException("python prompt extraction timed out");
            }
            if (process.exitValue() != 0) {
                throw new IllegalStateException("python prompt extraction failed\n" + err);
            }
            return out;
        } catch (IOException exc) {
            throw new IllegalStateException("failed to run python", exc);
        } catch (InterruptedException exc) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("interrupted while extracting prompt", exc);
        }
    }

    private static String pythonLiteral(String value) {
        return "'" + value.replace("\\", "\\\\").replace("'", "\\'") + "'";
    }

    static boolean pythonIsAvailable() {
        boolean present = Files.isExecutable(pythonExecutable());
        if (!present && "1".equals(System.getenv("REQUIRE_ALEMBIC_CHECK"))) {
            throw new IllegalStateException("REQUIRE_ALEMBIC_CHECK=1 인데 apps/api 의 venv 가 없다");
        }
        return present;
    }

    private static Path pythonExecutable() {
        return apiRoot().resolve(".venv/bin/python");
    }

    private static Path apiRoot() {
        return Paths.get("..", "api").toAbsolutePath().normalize();
    }
}
