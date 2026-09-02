package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.support.FrozenValue;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class CoachEngineTest {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
    private static final UUID OPERATION =
            UUID.fromString("99999999-8888-7777-6666-555555555555");
    private final RecordingFailureReporter failureReporter = new RecordingFailureReporter();

    /** 7번째부터의 안전 문구. 그 외는 분석 갈래라 분석 문장을 받는다. */
    private static final Map<String, String> CLOSING_SAFE_TEMPLATE_BY_KIND = Map.of(
            "분석", "coach-safe-template-closing-analysis.txt",
            "그 외", "coach-safe-template-closing-analysis.txt",
            "표현", "coach-safe-template-closing-expression.txt");

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
        RecordingGenerator generator = new RecordingGenerator("");

        CoachResult result = engine(generator).reply(session(), "모르겠어요", OPERATION);

        assertThat(result.reply()).isEqualTo(new CoachReply("", "continue", null));
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

        assertThat(result.reply()).isEqualTo(new CoachReply(
                FrozenValue.of("coach-safe-template.txt"), "continue", null));
        assertThat(generator.inputs).hasSize(2);
    }

    /** 6번째까지는 종전 안전 문구(질문)가 그대로 나간다. 갈래는 문장을 가르지 않는다. */
    @Test
    @DisplayName("6번째 응답의 안전 문구는 갈래와 무관하게 종전 질문 그대로다")
    void safeTemplateStaysAQuestionThroughSixthTurn() {
        for (String kind : CLOSING_SAFE_TEMPLATE_BY_KIND.keySet()) {
            assertThat(safeReplyAfterTwoFailures(6, kind))
                    .as("blockage_kind=%s 6번째", kind)
                    .isEqualTo(new CoachReply(
                            FrozenValue.of("coach-safe-template.txt"), "continue", null));
        }
    }

    /**
     * 7번째부터는 마지막 구간이다 — 모델 답이 두 번 검증에 걸려도 새 질문을 내지 않고 배우의
     * 말로 정리해 달라고 청한다. 분석(그 외 포함)은 다음 테이크에서 해볼 것 하나, 표현은 다음
     * 연습에서 유지할 것 하나다. 8번째도 같은 문장이고 상태는 continue 그대로다.
     */
    @Test
    @DisplayName("7번째 이상의 안전 문구는 새 질문 대신 갈래별 정리 청유다")
    void safeTemplateBecomesClosingRequestFromSeventhTurn() {
        for (int turnNumber : List.of(7, 8)) {
            CLOSING_SAFE_TEMPLATE_BY_KIND.forEach((kind, fixture) ->
                    assertThat(safeReplyAfterTwoFailures(turnNumber, kind))
                            .as("blockage_kind=%s %d번째", kind, turnNumber)
                            .isEqualTo(new CoachReply(
                                    FrozenValue.of(fixture), "continue", null)));
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
            RecordingGenerator generator = new RecordingGenerator("계속할게요");
            CoachResult result = engine(generator).reply(session(), closing, OPERATION);

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

    private CoachEngine engine(TextGenerator generator) {
        return new CoachEngine(generator, failureReporter);
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
