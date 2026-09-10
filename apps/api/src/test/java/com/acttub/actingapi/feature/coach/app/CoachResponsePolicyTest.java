package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.coach.domain.CoachHelpIntent;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.feature.coach.domain.HandoffReadiness;
import com.acttub.actingapi.feature.report.app.ReportEngine;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TextValidator;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

/** 합성 사례만 쓴다. 운영 대화·개인정보는 fixture에 넣지 않는다. */
class CoachResponsePolicyTest {
    private static final ObjectMapper MAPPER = new ObjectMapper();

    @Test
    void allBranchesKeepFirstLayerPackAndEarlyCorrectionsThroughClosing() throws Exception {
        for (String branch : List.of("분석", "표현", "그 외")) {
            List<CoachTurnSnapshot> turns = new ArrayList<>(List.of(
                    actor("말끝이 길어져요"), ai("인물의 목적을 볼까?"),
                    actor("목적은 정했어요. 발음과 음가 처리에 대한 질문이에요."), ai("발음을 살펴볼게요.")));
            for (int index = 0; index < 5; index++) {
                turns.add(actor("마지막 단어 길이가 궁금해요 " + index));
                turns.add(ai("마지막 단어만 살펴보자 " + index));
            }
            CoachSessionSnapshot session = session(branch, turns);
            String input = CoachPrompt.buildChat(session, "정리해 주세요");
            assertThat(input).contains("발음과 음가 처리에 대한 질문이에요", "배우: 말끝이 길어져요",
                    "내일 다시 만나자", "말끝에서 고개를 돌린다", "약속을 확인한 뒤 돌아선다",
                    "\"avg_syllables_per_sec\":5.0", "\"quote\":\"내일 다시 만나자\"",
                    "음질 때문에 말끝의 발음은 확인하기 어려움", "현재 응답: 8번째");
            if (branch.equals("표현")) assertThat(input).contains("이전 분석 세션에서 전달받은 입력 정보", "다시 만날 약속");
            else assertThat(input).doesNotContain("이전 분석 세션에서 전달받은 입력 정보");
            assertThat(CoachPrompt.select(branch)).contains(
                    "채팅에 쓴 문장은 기본적으로 코치에게 하는 말이다",
                    "질문에는 먼저 답한다", "원하는 결과와 가능한 결과는 다르다",
                    "모바일의 마이크도 말을 텍스트로 입력하는 기능",
                    "현재 대화 원문이 지난 요약", "배우가 쓰는 언어로",
                    "\"네\", \"맞아\", \"알겠어\"만으로 실험을 했거나 좋아졌다고 기록하지 않는다");
        }
    }

    @Test
    void failedPriorAnalysisIsNotPresentedAsConfirmedContextForExpression() throws Exception {
        CoachSessionSnapshot source = session("표현", List.of());
        CoachSessionSnapshot session = new CoachSessionSnapshot(
                source.sessionId(), source.practiceSessionId(), source.summaryId(), source.userId(),
                source.observationPack(), source.situation(), source.characterContext(), source.goal(),
                source.durationMs(), source.blockageKind(), source.subBranch(), source.blockageDetail(),
                source.transcripts(), source.conversationSummary(),
                MAPPER.readTree("{\"completion_level\":\"unavailable\"}"), source.status(), source.closeReason(), source.turns());
        assertThat(CoachPrompt.buildChat(session, "말끝이 궁금해요"))
                .contains("표현 세션 입력 정보", "말끝에서 고개를 돌린다", "내일 다시 만나자")
                .doesNotContain("이전 분석 세션에서 전달받은 입력 정보");
    }

    @Test
    void repeatedUnsureChangesGenerationInputButPreservesActorsActualWords() throws Exception {
        CoachSessionSnapshot session = session("분석", List.of(
                actor("의미를 모르겠어요"), ai("상대에게 뭘 바라는 걸까?"),
                actor("잘 모르겠어요"), ai("붙잡는 것과 설명하는 것 중 어느 쪽일까?")));
        List<String> inputs = new ArrayList<>();
        TextGenerator generator = (system, input) -> {
            inputs.add(input);
            return generated("{\"message\":\"예를 들어 약속을 확인하는 말일 수 있어요. 아직 확정된 해석은 아니에요.\"}");
        };
        CoachResult result = new CoachEngine(generator, new RecordingFailureReporter())
                .reply(session, "모르겠어요", UUID.randomUUID());
        assertThat(inputs).singleElement().asString().contains("여러 번 모르겠다고 했다", "선택지나 실행·자기정리 요청을 반복하지 않는다");
        assertThat(result.session().turns().get(result.session().turns().size() - 2).text())
                .isEqualTo("모르겠어요");
        assertThat(CoachResponsePolicy.recoveryInstruction(session.withTurns(List.of()), "의미를 모르겠어요"))
                .isEmpty();
    }

    @Test
    void exactRepeatedReplyAfterHelpRegeneratesOnce() throws Exception {
        List<String> inputs = new ArrayList<>();
        TextGenerator generator = (system, input) -> {
            inputs.add(input);
            return generated(inputs.size() == 1 ? "상대에게 뭘 바라는 걸까?" : "예를 들어, 약속을 확인하는 말일 수 있어요.");
        };
        CoachResult result = new CoachEngine(generator, new RecordingFailureReporter()).reply(
                session("분석", List.of(actor("의미"), ai("상대에게 뭘 바라는 걸까?"))),
                "예시로 설명해 주세요.", UUID.randomUUID());
        assertThat(inputs).hasSize(2);
        assertThat(inputs.getLast()).contains("직전 응답을 반복했다");
        assertThat(result.reply().message()).startsWith("예를 들어");
    }

    @Test
    void helpShortcutsDontBecomeReportEvidenceButSpecificAnswersStillCount() {
        List<CoachTurnSnapshot> turns = new ArrayList<>(List.of(actor("막힘 상세")));
        for (String help : List.of("잘 모르겠어요!", "I’m not sure.", "예시로 설명해 주세요.",
                "제가 되물을게요", "지금은 연습하기 어려워요. 다음에 해볼 방법을 설명해 주세요.",
                "I can’t practice now. Please explain what I can try later.")) {
            assertThat(CoachHelpIntent.isHelpOnly(help)).as(help).isTrue();
            turns.add(actor(help));
        }
        assertThat(HandoffReadiness.hasEnoughAnswers(turns)).isFalse();
        turns.add(actor("내일 만날 수 있을지 모르겠어요"));
        turns.add(actor("그래도 다시 만나고 싶다는 뜻이에요"));
        assertThat(HandoffReadiness.hasEnoughAnswers(turns)).isTrue();
    }

    @Test
    void coachAllowsDescriptiveFeedbackWhileKeepingOtherValidatorsAndProhibitions() {
        String feedback = "개선점은 말끝의 길이를 일정하게 정하는 것이에요.";
        assertThat(TextValidator.validateCoachTurn(feedback).failures()).isEmpty();
        assertThat(TextValidator.validateTurn(feedback, false).forbiddenHits()).contains("개선점");
        for (String invalid : List.of("점수는 90점", "그건 성격 때문이에요", "실제 가족 상처를 떠올려 보세요", "1:23의 대사")) {
            assertThat(TextValidator.validateCoachTurn(invalid).failures()).as(invalid).isNotEmpty();
        }
    }

    @Test
    void repairsMarkdownThatWouldBeShownLiterallyInTheChat() throws Exception {
        List<String> inputs = new ArrayList<>();
        TextGenerator generator = (system, input) -> {
            inputs.add(input);
            return generated(inputs.size() == 1
                    ? "{\"message\":\"**말끝**의 길이만 살펴봐요.\"}"
                    : "{\"message\":\"말끝의 길이만 살펴봐요.\"}");
        };
        CoachReply reply = new CoachEngine(generator, new RecordingFailureReporter()).reply(
                session("표현", List.of(actor("말끝이 길어요"), ai("마지막 모음을 볼게요."))),
                "예시로 설명해 주세요.", UUID.randomUUID()).reply();
        assertThat(inputs).hasSize(2);
        assertThat(inputs.getLast()).contains("Markdown 강조·제목·코드 기호를 제거");
        assertThat(reply.message()).isEqualTo("말끝의 길이만 살펴봐요.");
    }

    @Test
    void regeneratesInternalFormattingNotesExposedByTheModel() throws Exception {
        List<String> inputs = new ArrayList<>();
        TextGenerator generator = (system, input) -> {
            inputs.add(input);
            return generated(inputs.size() == 1
                    ? "{\"message\":\"마지막 두 어절이 빨라져요. JSON need.\"}"
                    : "{\"message\":\"마지막 두 어절이 빨라져요.\"}");
        };
        CoachReply reply = new CoachEngine(generator, new RecordingFailureReporter()).reply(
                session("표현", List.of(actor("속도가 궁금해요"), ai("어느 부분이 궁금해요?"))),
                "영상을 기준으로 말해 주세요.", UUID.randomUUID()).reply();
        assertThat(inputs).hasSize(2);
        assertThat(inputs.getLast()).contains("내부 작업 메모가 응답에 섞였다");
        assertThat(reply.message()).isEqualTo("마지막 두 어절이 빨라져요.");
    }

    @Test
    void englishConversationRepairsKoreanAnswerButAllowsQuotedTranscriptAndLanguageRequests() throws Exception {
        CoachSessionSnapshot session = session("표현", List.of(actor("How can I shorten the ending?"), ai("Try the last word.")));
        assertThat(CoachResponsePolicy.failures(session, "Can you explain?", new CoachReply("마지막 단어를 짧게 해보세요.", "continue", null)))
                .anyMatch(failure -> failure.contains("영어로 답한다"));
        assertThat(CoachResponsePolicy.failures(session, "Can you explain?", new CoachReply("Try shortening the last word of 내일 다시 만나자.", "continue", null)))
                .isEmpty();
        assertThat(CoachResponsePolicy.failures(session, "Please explain in Korean", new CoachReply("마지막 단어를 짧게 해보세요.", "continue", null)))
                .isEmpty();
    }

    @Test
    void handoffKeepsActorContentAndRemovesHelpControls() throws Exception {
        CoachEngine engine = new CoachEngine((system, input) -> generated("""
                {"message":"여기까지 정리할게요.","status":"complete","handoff":{
                  "actor_words":["예시로 설명해 주세요.","제가 되물을게요","그만","마지막 단어가 길게 나와요"]}}
                """), new RecordingFailureReporter());
        CoachReply reply = engine.reply(session("표현", List.of(actor("말끝"), ai("설명"))), "그만", UUID.randomUUID()).reply();
        assertThat(reply.handoff().path("actor_words")).hasSize(1);
        assertThat(reply.handoff().path("actor_words").get(0).asText()).isEqualTo("마지막 단어가 길게 나와요");
    }

    @Test
    void failedClosingCannotProduceOrRegenerateAReportAndKeepsEnglish() throws Exception {
        for (String branch : List.of("분석", "표현")) {
            CoachSessionSnapshot session = session(branch, List.of(
                    actor("I want to make the ending shorter."), ai("Try just the last word."),
                    actor("I haven’t tried it yet."), ai("You can try it later.")));
            CoachReply fallback = CoachResponsePolicy.fallback(session, "그만");
            assertThat(fallback.status()).isEqualTo("complete");
            assertThat(fallback.message()).startsWith("We’ll stop here");
            assertThat(TextValidator.validateCoachTurn(fallback.message()).failures()).isEmpty();
            ReportEngine reportEngine = new ReportEngine((system, input) -> {
                throw new AssertionError("Failed coaching must not become an invented report");
            }, MAPPER);
            assertThat(reportEngine.generateReport(branch.equals("표현") ? "expression" : "analysis",
                    session.observationPack(), fallback.handoff(), true, "handoff-id", null, null)
                    .path("report_type").asText()).isEqualTo("blocked");
        }
    }

    private static CoachSessionSnapshot session(String branch, List<CoachTurnSnapshot> turns) throws Exception {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                MAPPER.readTree("""
                        {"scene_summary":"동료와 다음 만남을 약속한다", "timeline":"약속을 확인한 뒤 돌아선다",
                        "speech":{"transcript":"내일 다시 만나자", "avg_syllables_per_sec":5.0,
                                  "pauses":[], "chunks":[]},
                        "observations":[{"start_ms":2000,"end_ms":3500,"what":"말끝에서 고개를 돌린다",
                                         "quote":"내일 다시 만나자", "dimension":"시선","confidence":0.8}],
                        "uncertainties":["음질 때문에 말끝의 발음은 확인하기 어려움"]}
                        """),
                "헤어지기 전 약속", "동료", "다시 만날 약속", 5000, branch, "말끝", "말끝이 길어져요",
                List.of("내일 다시 만나자"), "상대의 목적을 찾아본다는 이전 요약",
                MAPPER.readTree("{\"line_meaning\":\"다시 만날 약속\"}"), "open", "", turns);
    }

    private static CoachTurnSnapshot actor(String text) { return new CoachTurnSnapshot("actor", text); }
    private static CoachTurnSnapshot ai(String text) { return new CoachTurnSnapshot("ai", text); }
    private static GeneratedText generated(String text) { return new GeneratedText(text, new TokenUsage(0, 0, 0)); }
}
