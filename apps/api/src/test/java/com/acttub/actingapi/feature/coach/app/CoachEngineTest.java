package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class CoachEngineTest {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final UUID OPERATION =
            UUID.fromString("99999999-8888-7777-6666-555555555555");
    private final RecordingFailureReporter failureReporter = new RecordingFailureReporter();

    @Test
    void parsesFencedAndUnfencedJson() {
        CoachReply fenced = CoachEngine.parseCoachingResponse(
                "```JSON\n{\"message\":\" 질문 \"}\n```");
        CoachReply plain = CoachEngine.parseCoachingResponse(
                "{\"message\":\"답\",\"status\":\"continue\",\"handoff\":null}");

        assertThat(fenced).isEqualTo(new CoachReply("질문", "continue", null));
        assertThat(plain).isEqualTo(new CoachReply("답", "continue", null));
    }

    @Test
    void nonJsonAndNonStringMessagePassThroughAsOriginalText() {
        assertThat(CoachEngine.parseCoachingResponse("  평문 답변  "))
                .isEqualTo(new CoachReply("평문 답변", "continue", null));
        assertThat(CoachEngine.parseCoachingResponse("{\"message\":42}"))
                .isEqualTo(new CoachReply("{\"message\":42}", "continue", null));
    }

    @Test
    void generatedNonJsonFallsBackAndIsReportedAsExternal() {
        RecordingGenerator generator = new RecordingGenerator("평문 답변");

        CoachResult result = engine(generator).reply(session(), "모르겠어요", OPERATION);

        assertThat(result.reply()).isEqualTo(new CoachReply("평문 답변", "continue", null));
        assertThat(failureReporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isInstanceOf(JsonProcessingException.class);
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
            assertThat(report.context())
                    .isEqualTo("CoachEngine.responseParse operation_id=" + OPERATION);
        });
    }

    @Test
    void emptyGeneratedResponseFallsBackAndIsReportedAsExternal() {
        RecordingGenerator generator = new RecordingGenerator("", "{\"message\":\"다시 설명할게요.\"}");

        CoachResult result = engine(generator).reply(session(), "모르겠어요", OPERATION);

        assertThat(result.reply()).isEqualTo(new CoachReply("다시 설명할게요.", "continue", null));
        assertThat(failureReporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
            assertThat(report.context())
                    .isEqualTo("CoachEngine.responseParse operation_id=" + OPERATION);
        });
    }

    @Test
    void completeRequiresObjectHandoffAndOtherwiseDowngrades() {
        CoachReply complete = CoachEngine.parseCoachingResponse(
                "{\"message\":\"끝\",\"status\":\"complete\",\"handoff\":{\"x\":1}}");
        CoachReply downgraded = CoachEngine.parseCoachingResponse(
                "{\"message\":\"끝\",\"status\":\"complete\",\"handoff\":[1]}");

        assertThat(complete.status()).isEqualTo("complete");
        assertThat(complete.handoff()).isEqualTo(OBJECT_MAPPER.createObjectNode().put("x", 1));
        assertThat(downgraded).isEqualTo(new CoachReply("끝", "continue", null));
    }

    @Test
    void regeneratesOnceAfterValidationFailureAndUsesSecondValidReply() {
        RecordingGenerator generator = new RecordingGenerator(
                "{\"message\":\"점수로 볼게요\"}",
                "{\"message\":\"상대가 어떻게 되길 바라나요?\"}");
        CoachEngine engine = engine(generator);

        CoachResult result = engine.reply(session(), "잘 모르겠어요", OPERATION);

        assertThat(result.reply().message()).isEqualTo("상대가 어떻게 되길 바라나요?");
        assertThat(generator.inputs).hasSize(2);
        assertThat(generator.inputs.get(1))
                .contains("금지어가 노출됐습니다: 점수")
                .contains("## 노출하지 않은 실패 응답\n{\"message\":\"점수로 볼게요\"}");
    }

    @Test
    void usesSafeTemplateAfterExactlyTwoInvalidGenerations() {
        RecordingGenerator generator = new RecordingGenerator("점수", "등급");
        CoachResult result = engine(generator).reply(session(), "모르겠어요", OPERATION);

        assertThat(result.reply().status()).isEqualTo("continue");
        assertThat(result.reply().message()).contains("예를 들어").doesNotContain("?");
        assertThat(generator.inputs).hasSize(2);
    }

    @Test
    void seventhFallbackExplainsWithoutDemandingSelfSummaryAndEighthCloses() {
        for (String kind : List.of("분석", "표현", "그 외")) {
            assertThat(safeReplyAfterTwoFailures(7, kind).message())
                    .doesNotContain("정리해", "?", "해보고");
            for (int turn : List.of(8, 9)) {
                CoachReply reply = safeReplyAfterTwoFailures(turn, kind);
                assertThat(reply.status()).isEqualTo("complete");
                assertThat(reply.handoff().path("completion_level").asText()).isEqualTo("unavailable");
                assertThat(reply.handoff().path("actor_words")).isEmpty();
            }
        }
    }

    /** 모델이 두 번 다 금지어로 답한 뒤 배우에게 가는 응답. */
    private CoachReply safeReplyAfterTwoFailures(int turnNumber, String blockageKind) {
        RecordingGenerator generator = new RecordingGenerator("점수", "등급");
        return engine(generator)
                .reply(sessionAtTurn(turnNumber, blockageKind), "모르겠어요", OPERATION)
                .reply();
    }

    @Test
    void closingWordsAppendInstructionOnlyToGenerationInputNotStoredTurn() {
        // "끝"·"여기까지"는 발화 전체가 그 말일 때만 종료다. 어절 안에 섞인 "끝"까지
        // 종료로 보면 "끝까지 해볼게요" 같은 정상 답변에서 세션이 끊긴다.
        for (String closing : List.of("이제 그만", "이제 종료", "끝", "여기까지", "여기서 그만할게")) {
            RecordingGenerator generator = new RecordingGenerator("계속할게요", "계속할게요");
            CoachResult result = engine(generator).reply(session(), closing, OPERATION);

            assertThat(result.reply().status()).isEqualTo("complete");
            assertThat(generator.inputs).hasSize(2);
            assertThat(generator.inputs.getFirst())
                    .contains("## 배우의 마무리 요청")
                    .contains("배우가 지금 대화를 마치겠다고 했다.");
            assertThat(result.session().turns().get(result.session().turns().size() - 2).text())
                    .isEqualTo(closing)
                    .doesNotContain("## 배우의 마무리 요청");
        }
    }

    @Test
    @DisplayName("종료어를 품었을 뿐인 정상 답변에는 마무리 지시문이 붙지 않는다")
    void wordBoundaryKeepsOrdinaryAnswersOutOfClosing() {
        // 어절 경계 없는 오타 '그렇그만'으로 세션이 끊긴 사고가 있었다.
        for (String ordinary : List.of("이제 끝", "끝까지 해볼게요", "안 그만할래요", "그렇그만")) {
            RecordingGenerator generator = new RecordingGenerator("계속할게요");
            engine(generator).reply(session(), ordinary, OPERATION);

            assertThat(generator.inputs.getFirst()).doesNotContain("## 배우의 마무리 요청");
        }
    }

    @Test
    void generatesBeforeAppendingActorAndAiTurns() {
        RecordingGenerator generator = new RecordingGenerator("새 답변");
        CoachSessionSnapshot before = session();

        CoachResult result = engine(generator).reply(before, "새 질문", OPERATION);

        assertThat(generator.inputs.getFirst())
                .doesNotContain("배우: 새 질문")
                .doesNotContain("코치: 새 답변");
        assertThat(result.session().turns()).endsWith(
                new CoachTurnSnapshot("actor", "새 질문"),
                new CoachTurnSnapshot("ai", "새 답변"));
        assertThat(before.turns()).hasSize(2);
    }

    @Test
    void startFallsBackFromDetailToGoalToBlockageKindAndStoresActorThenAi() {
        RecordingGenerator detailGenerator = new RecordingGenerator("첫 답변");
        CoachResult detail = engine(detailGenerator).start(sessionWithoutTurns(), OPERATION);

        assertThat(detail.session().turns()).containsExactly(
                new CoachTurnSnapshot("actor", "왜 지금인지 모르겠다"),
                new CoachTurnSnapshot("ai", "첫 답변"));
        assertThat(detailGenerator.inputs.getFirst()).contains("## 배우의 최신 말\n왜 지금인지 모르겠다");

        RecordingGenerator goalGenerator = new RecordingGenerator("첫 답변");
        CoachSessionSnapshot blankDetail = snapshotWith("", "담담하게 말한다");
        CoachResult goal = engine(goalGenerator).start(blankDetail, OPERATION);

        assertThat(goal.session().turns().getFirst())
                .isEqualTo(new CoachTurnSnapshot("actor", "담담하게 말한다"));
        assertThat(goalGenerator.inputs.getFirst()).contains("## 배우의 최신 말\n담담하게 말한다");
    }

    /**
     * 장면까지 건너뛰면 목표도 비어 배우가 아무 말도 안 한 채로 대화가 열린다. 사슬 끝의
     * 막힘 대분류는 <b>항상 값이 있는 유일한 칸</b>이라 첫 발화가 비지 않는다 — 배우가 직접
     * 고른 값이면 거짓이 남지 않고, 막힘까지 건너뛴 세션은 건너뛰기 값 {@code 그 외} 가 그대로
     * 남는다.
     */
    @Test
    @DisplayName("상세도 목표도 비면 첫 발화가 막힘 대분류가 된다")
    void startFallsBackToBlockageKindWhenSceneIsSkipped() {
        RecordingGenerator generator = new RecordingGenerator("첫 답변");

        CoachResult result = engine(generator).start(snapshotWith("", ""), OPERATION);

        assertThat(result.session().turns().getFirst())
                .isEqualTo(new CoachTurnSnapshot("actor", "분석"));
        assertThat(generator.inputs.getFirst()).contains("## 배우의 최신 말\n분석");
    }

    /** 공백만 든 값은 배우가 한 말이 아니다 — 대화 이력에 공백 한 칸을 남기지 않는다. */
    @Test
    @DisplayName("공백만 든 상세·목표도 건너뛰고 막힘 대분류로 떨어진다")
    void startTreatsWhitespaceOnlyDetailAndGoalAsAbsent() {
        RecordingGenerator generator = new RecordingGenerator("첫 답변");

        CoachResult result = engine(generator).start(snapshotWith(" ", "\t"), OPERATION);

        assertThat(result.session().turns().getFirst())
                .isEqualTo(new CoachTurnSnapshot("actor", "분석"));
    }

    /**
     * 1차와 재생성이 <b>따로</b> 남는다.
     *
     * <p>둘을 한 건으로 합치면 재생성 비율을 셀 수 없다 — 그 비율이 곧 "모델이 몇 번에
     * 한 번 규칙을 어기나" 이고, 이 작업이 보려는 숫자다(SOMA-517).
     */
    @Test
    @DisplayName("코치 1차와 재생성이 각각 한 건씩 관측에 남는다")
    void firstAndRegeneratedCallsAreRecordedSeparately() {
        RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
        CoachEngine engine = new CoachEngine(
                new RecordingGenerator(
                        "{\"message\":\"점수로 볼게요\"}",
                        "{\"message\":\"상대가 어떻게 되길 바라나요?\"}"),
                failureReporter,
                telemetry);

        engine.reply(session(), "잘 모르겠어요", OPERATION);

        assertThat(telemetry.steps())
                .containsExactly(LlmStep.COACH_TURN, LlmStep.COACH_REGENERATION);
        LlmCall first = telemetry.calls().getFirst();
        // 기록을 묶는 열쇠는 연습 세션이다 — 코치 세션이 아니다.
        assertThat(first.practiceSessionId())
                .isEqualTo(UUID.fromString("00000000-0000-0000-0000-000000000002"));
        assertThat(first.userId())
                .isEqualTo(UUID.fromString("00000000-0000-0000-0000-000000000003"));
        assertThat(first.output()).contains("점수로 볼게요");
        assertThat(first.failed()).isFalse();
        assertThat(first.metadata()).containsEntry("turn", "2");
        // 재생성 입력에는 무엇에 걸렸는지가 들어 있어야 재현이 된다.
        assertThat(telemetry.calls().get(1).input()).contains("금지어가 노출됐습니다: 점수");
    }

    /**
     * 품질 판정이 점수로 쌓인다 — 이 숫자가 "들쭉날쭉" 을 눈이 아니라 비율로 보게 한다.
     */
    @Test
    @DisplayName("검증에 걸린 응답은 재생성·실패 갈래가 점수로 남는다")
    void validationOutcomeIsScored() {
        RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
        new CoachEngine(
                new RecordingGenerator(
                        "{\"message\":\"점수로 볼게요\"}",
                        "{\"message\":\"상대가 어떻게 되길 바라나요?\"}"),
                failureReporter,
                telemetry)
                .reply(session(), "잘 모르겠어요", OPERATION);

        assertThat(telemetry.scoreNames())
                .contains("coach.regenerated", "coach.fallback_used", "coach.validation_failure");
        assertThat(telemetry.scores())
                .filteredOn(score -> score.name().equals("coach.regenerated"))
                .singleElement()
                .satisfies(score -> assertThat(score.value()).isEqualTo(1.0));
        // 두 번째 응답이 통과했으므로 안전 문구로 물러나지 않았다.
        assertThat(telemetry.scores())
                .filteredOn(score -> score.name().equals("coach.fallback_used"))
                .singleElement()
                .satisfies(score -> assertThat(score.value()).isEqualTo(0.0));
        // 갈래 이름은 실패 문구의 첫 마디다.
        assertThat(telemetry.scores())
                .filteredOn(score -> score.name().equals("coach.validation_failure"))
                .allSatisfy(score -> assertThat((String) score.value()).doesNotContain(":"));
    }

    /** 실패도 같은 모양으로 남는다 — 실패만 빠지면 비율이 거짓이 된다. */
    @Test
    @DisplayName("모델 호출이 터져도 그 한 건이 남고 예외는 그대로 올라간다")
    void failedCallIsRecordedAndRethrown() {
        RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
        CoachEngine engine = new CoachEngine(
                (instructions, input) -> {
                    throw new IllegalStateException("OpenAI 생성 실패");
                },
                failureReporter,
                telemetry);

        assertThatThrownBy(() -> engine.reply(session(), "잘 모르겠어요", OPERATION))
                .isInstanceOf(IllegalStateException.class);

        assertThat(telemetry.calls()).singleElement().satisfies(call -> {
            assertThat(call.step()).isEqualTo(LlmStep.COACH_TURN);
            assertThat(call.failed()).isTrue();
            assertThat(call.errorMessage()).isEqualTo("OpenAI 생성 실패");
        });
    }

    private CoachEngine engine(TextGenerator generator) {
        return new CoachEngine(generator, failureReporter, new RecordingLlmTelemetry());
    }

    private static CoachSessionSnapshot session() {
        return new CoachSessionSnapshot(
                UUID.fromString("00000000-0000-0000-0000-000000000001"),
                UUID.fromString("00000000-0000-0000-0000-000000000002"),
                null,
                UUID.fromString("00000000-0000-0000-0000-000000000003"),
                null,
                "연습실",
                "지원자",
                "담담하게 말한다",
                93000,
                "분석",
                "대사의 의미",
                "왜 지금인지 모르겠다",
                List.of("첫 대사"),
                "",
                null,
                "open",
                "",
                List.of(
                        new CoachTurnSnapshot("actor", "이전 질문"),
                        new CoachTurnSnapshot("ai", "이전 답변")));
    }

    private static CoachSessionSnapshot sessionWithoutTurns() {
        return snapshotWith("왜 지금인지 모르겠다", "담담하게 말한다");
    }

    /** 첫 발화 폴백 사슬이 읽는 두 값만 갈아끼운다. 턴은 비운다. */
    private static CoachSessionSnapshot snapshotWith(String detail, String goal) {
        CoachSessionSnapshot source = session();
        return new CoachSessionSnapshot(
                source.sessionId(), source.practiceSessionId(), source.summaryId(), source.userId(),
                source.observationPack(), source.situation(), source.characterContext(), goal,
                source.durationMs(), source.blockageKind(), source.subBranch(), detail,
                source.transcripts(), source.conversationSummary(), source.analysisHandoff(),
                source.status(), source.closeReason(), List.of());
    }

    /**
     * 응답 번호가 {@code turnNumber} 가 되도록 배우·코치 turn 을 채운 세션. 응답 번호는
     * 코치 turn 수 + 1 이다({@code CoachPrompt.turnNumber}). 갈래만 갈아끼운다.
     */
    private static CoachSessionSnapshot sessionAtTurn(int turnNumber, String blockageKind) {
        CoachSessionSnapshot source = session();
        List<CoachTurnSnapshot> turns = new ArrayList<>();
        for (int index = 1; index < turnNumber; index++) {
            turns.add(new CoachTurnSnapshot("actor", "배우 말 " + index));
            turns.add(new CoachTurnSnapshot("ai", "코치 말 " + index));
        }
        return new CoachSessionSnapshot(
                source.sessionId(), source.practiceSessionId(), source.summaryId(), source.userId(),
                source.observationPack(), source.situation(), source.characterContext(),
                source.goal(), source.durationMs(), blockageKind, source.subBranch(),
                source.blockageDetail(), source.transcripts(), source.conversationSummary(),
                source.analysisHandoff(), source.status(), source.closeReason(), turns);
    }

    private static final class RecordingGenerator implements TextGenerator {
        private final List<String> replies;
        private final List<String> inputs = new ArrayList<>();

        RecordingGenerator(String... replies) {
            this.replies = List.of(replies);
        }

        @Override
        public GeneratedText generate(String instructions, String input) {
            inputs.add(input);
            return new GeneratedText(
                    replies.get(inputs.size() - 1), new TokenUsage(0, 0, 0));
        }
    }
}
