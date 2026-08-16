package com.acttub.actingapi.coach;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class CoachEngineTest {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

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
        CoachEngine engine = new CoachEngine(generator);

        CoachResult result = engine.reply(session(), "잘 모르겠어요");

        assertThat(result.reply().message()).isEqualTo("상대가 어떻게 되길 바라나요?");
        assertThat(generator.inputs).hasSize(2);
        assertThat(generator.inputs.get(1))
                .contains("금지어가 노출됐습니다: 점수")
                .contains("## 노출하지 않은 실패 응답\n{\"message\":\"점수로 볼게요\"}");
    }

    @Test
    void usesSafeTemplateAfterExactlyTwoInvalidGenerations() {
        RecordingGenerator generator = new RecordingGenerator("점수", "등급");
        CoachResult result = new CoachEngine(generator).reply(session(), "모르겠어요");

        assertThat(result.reply()).isEqualTo(
                new CoachReply(CoachPrompt.safeTemplate(), "continue", null));
        assertThat(generator.inputs).hasSize(2);
    }

    @Test
    void closingWordsAppendInstructionOnlyToGenerationInputNotStoredTurn() {
        // "끝"·"여기까지"는 발화 전체가 그 말일 때만 종료다. 어절 안에 섞인 "끝"까지
        // 종료로 보면 "끝까지 해볼게요" 같은 정상 답변에서 세션이 끊긴다.
        for (String closing : List.of("이제 그만", "이제 종료", "끝", "여기까지", "여기서 그만할게")) {
            RecordingGenerator generator = new RecordingGenerator("계속할게요");
            CoachResult result = new CoachEngine(generator).reply(session(), closing);

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
            new CoachEngine(generator).reply(session(), ordinary);

            assertThat(generator.inputs.getFirst()).doesNotContain("## 배우의 마무리 요청");
        }
    }

    @Test
    void generatesBeforeAppendingActorAndAiTurns() {
        RecordingGenerator generator = new RecordingGenerator("새 답변");
        CoachSessionSnapshot before = session();

        CoachResult result = new CoachEngine(generator).reply(before, "새 질문");

        assertThat(generator.inputs.getFirst())
                .doesNotContain("배우: 새 질문")
                .doesNotContain("코치: 새 답변");
        assertThat(result.session().turns()).endsWith(
                new CoachTurnSnapshot("actor", "새 질문"),
                new CoachTurnSnapshot("ai", "새 답변"));
        assertThat(before.turns()).hasSize(2);
    }

    @Test
    void startUsesBlockageDetailOrGoalAndStoresActorThenAi() {
        RecordingGenerator detailGenerator = new RecordingGenerator("첫 답변");
        CoachResult detail = new CoachEngine(detailGenerator).start(sessionWithoutTurns());

        assertThat(detail.session().turns()).containsExactly(
                new CoachTurnSnapshot("actor", "왜 지금인지 모르겠다"),
                new CoachTurnSnapshot("ai", "첫 답변"));
        assertThat(detailGenerator.inputs.getFirst()).contains("## 배우의 최신 말\n왜 지금인지 모르겠다");

        RecordingGenerator goalGenerator = new RecordingGenerator("첫 답변");
        CoachSessionSnapshot blankDetail = snapshotWithDetail("");
        CoachResult goal = new CoachEngine(goalGenerator).start(blankDetail);

        assertThat(goal.session().turns().getFirst())
                .isEqualTo(new CoachTurnSnapshot("actor", "담담하게 말한다"));
        assertThat(goalGenerator.inputs.getFirst()).contains("## 배우의 최신 말\n담담하게 말한다");
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
        return snapshotWithDetail("왜 지금인지 모르겠다");
    }

    private static CoachSessionSnapshot snapshotWithDetail(String detail) {
        CoachSessionSnapshot source = session();
        return new CoachSessionSnapshot(
                source.sessionId(), source.practiceSessionId(), source.summaryId(), source.userId(),
                source.observationPack(), source.situation(), source.characterContext(), source.goal(),
                source.durationMs(), source.blockageKind(), source.subBranch(), detail,
                source.transcripts(), source.conversationSummary(), source.analysisHandoff(),
                source.status(), source.closeReason(), List.of());
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
