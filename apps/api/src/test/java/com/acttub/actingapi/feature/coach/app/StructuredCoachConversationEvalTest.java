package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.integration.llm.OpenAiResponsesClient;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/** Opt-in real-model conversations using only the repository's synthetic video record. */
@EnabledIfEnvironmentVariable(named = "ACTTUB_COACH_EVAL", matches = "1")
@EnabledIfEnvironmentVariable(named = "OPENAI_API_KEY", matches = ".+")
class StructuredCoachConversationEvalTest {
    @Test void confusionCorrectionAndStop() throws Exception {
        evaluate("confusion-correction", List.of("ㅁㄹ", "?", "내가 실수로 말했어", "그만"));
    }
    @Test void ordinaryAnswersAndRequestForHelp() throws Exception {
        evaluate("ordinary-help", List.of("떠나는 사람을 붙잡으려고 했어", "대사를 생각하느라 그랬어", "그래서 어떻게 하면 돼?", "여기까지"));
    }
    /**
     * account.profile: 프로필이 실린 대화. 저장된 출력에서 사람이 볼 것 — 프로필 항목을 다시 묻지 않는지,
     * 경력(입시생)에 맞는 말인지, 프로필의 최종 목표를 이 장면의 목표로 삼지 않는지, 옛 기억(남·31)이 새지 않는지.
     */
    @Test void profileInformsTheConversationWithoutBeingAskedAgain() throws Exception {
        evaluate("actor-profile", List.of("떠나는 사람을 붙잡으려고 했어", "쉽게 설명해 줘", "여기까지"),
                new ActorProfile("김하늘", "여성", 19, List.of("무대(연극·뮤지컬)"), "입시생", "전문 배우"),
                new PriorContext(java.util.Map.of("gender", "남", "age", "31", "goal", "입시 합격"), null, true, List.of(), List.of()));
    }
    private void evaluate(String name, List<String> replies) throws Exception {
        evaluate(name, replies, null, PriorContext.EMPTY);
    }
    private void evaluate(String name, List<String> replies, ActorProfile profile, PriorContext prior) throws Exception {
        var session = new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.resource("/coaching/record.json"), "", "", "", 8000, "그 외", "그 외", null,
                List.of(), "", null, "open", "", List.of()).withCoachingState("three_layers_v1", 0, null, "open", "")
                .withPrior(prior).withActorProfile(profile);
        var output = StructuredJson.MAPPER.createObjectNode().put("case", name).put("semantic_review", "pending");
        var failures = new RecordingFailureReporter();
        var calls = output.putArray("calls");
        var client = new OpenAiResponsesClient(StructuredJson.MAPPER);
        var engine = new CoachEngine((system, input) -> {
            var call = calls.addObject();
            call.set("input", StructuredJson.parse(input));
            var generated = client.generate(system, input);
            call.put("model", generated.model()).put("output", generated.text());
            return generated;
        }, failures, new RecordingLlmTelemetry());
        var messages = output.putArray("messages");
        Path dir = Path.of("build", "structured-coach-eval");
        Files.createDirectories(dir);
        try {
            CoachResult result = engine.start(session, UUID.randomUUID());
            messages.addObject().put("role", "ai").put("text", result.reply().message());
            session = result.session();
            for (int i = 0; i < replies.size(); i++) {
                if ("closed".equals(session.status()) && i == replies.size() - 1 && (name.equals("ordinary-help") || name.equals("actor-profile"))) break;
                String answer = replies.get(i);
                assertThat(session.status()).isEqualTo("open");
                messages.addObject().put("role", "actor").put("text", answer);
                result = engine.reply(session, answer, UUID.randomUUID());
                session = result.session();
                if (answer.equals("ㅁㄹ") || answer.equals("?")) {
                    assertThat(session.coachingState().path("last_reply").path("move").asText())
                            .isIn("explain", "clarify", "simplify");
                    assertThat(result.reply().message()).doesNotContain("말해보세요", "기다려보세요", "잡아보세요", "기다리세요");
                }
                if (answer.equals("내가 실수로 말했어")) {
                    assertThat(OpeningQuestion.questionCount(result.reply().message())).isEqualTo(1);
                    assertThat(result.session().coachingState().path("last_reply").path("move").asText()).isEqualTo("clarify");
                }
                messages.addObject().put("role", "ai").put("text", result.reply().message());
                assertThat(result.reply().message()).doesNotContain("지금은 이 구간을 더 확인하기 어려워요", "영상에 근거한 설명을 준비하지 못했어요", "기대답변");
            }
            assertThat(session.status()).isEqualTo("closed");
            assertThat(OpeningQuestion.questionCount(result.reply().message())).isZero();
            if (profile != null) {
                // 계약 검사까지만 한다. 프로필을 잘 썼는지는 저장된 출력을 사람이 본다(semantic_review).
                for (var call : calls) {
                    assertThat(call.path("input").path("actor_profile").path("experience").asText()).isEqualTo(profile.experience());
                    assertThat(call.path("input").path("prior_context").path("memory").has("gender")).isFalse();
                    assertThat(call.path("input").path("prior_context").path("memory").has("age")).isFalse();
                }
            }
            output.set("state", session.coachingState());
        } finally {
            var errors = output.putArray("errors");
            failures.reports().forEach(report -> errors.add(report.failure().getMessage()));
            StructuredJson.MAPPER.writerWithDefaultPrettyPrinter().writeValue(dir.resolve(name + ".json").toFile(), output);
        }
    }
}
