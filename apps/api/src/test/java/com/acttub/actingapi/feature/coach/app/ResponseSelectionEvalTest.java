package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.OpenAiResponsesClient;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Synthetic requests; automated routing checks still require review of the saved replies. */
@EnabledIfEnvironmentVariable(named = "ACTTUB_COACH_EVAL", matches = "1")
@EnabledIfEnvironmentVariable(named = "OPENAI_API_KEY", matches = ".+")
class ResponseSelectionEvalTest {
    record Scenario(String name, String previous, String actor, List<String> moves, boolean questionAllowed) { }

    static Stream<Scenario> scenarios() {
        return Stream.of(
            new Scenario("concrete-action", "상대에게 왜 가지 말라고 하나요?",
                "친구가 화가 나서 가려고 해요. 내 사과를 듣고 가도록 붙잡으려는 거예요. 어떻게 연기하면 좋을지 하나만 알려줘.", List.of("suggest"), false),
            new Scenario("unclear-question", "이 말로 상대에게 어떤 변화를 원하나요?",
                "질문이 무슨 말인지 모르겠어요. 쉽게 설명해줘요.", List.of("simplify", "explain"), true),
            new Scenario("unknown-twice", "떠나려는 사람에게 가지 말라고 하는 이유를 생각해볼까요?",
                "아까도 모르겠다고 했잖아. 다시 묻지 말고 이 대사에서 알 수 있는 걸 설명해줘.", List.of("explain"), false),
            new Scenario("correct-premise", "헤어지기 싫어서 붙잡는 상황이군요.",
                "아니요. 헤어지는 장면이 아니에요. 동료가 내 지갑을 갖고 나가려 해서 지갑만 돌려받으려는 거예요.", List.of("correct", "suggest"), true),
            new Scenario("assess-delivery", "상대가 머물러 주길 부탁하는 상황이군요.",
                "맞아. 이 영상에서 내 말투가 부탁처럼 들리는지 피드백해줘. 관계나 이유는 더 묻지 말고.", List.of("assess"), false),
            new Scenario("transfer-strength", "마지막 음절을 길게 이어 말하는 것이 상대가 머물기를 바라는 부탁으로 들릴 수 있어요.",
                "그 선택은 마음에 들어. 다른 부탁 장면에서도 잘된 걸 살리려면 뭘 기억해야 해?", List.of("extend", "suggest"), false),
            new Scenario("stop", "상대에게 머물러 달라고 부탁하는 선택을 이야기했어요.",
                "알겠어. 오늘은 여기까지.", List.of("close"), false),
            new Scenario("missing-hand-observation", "상대가 머물기를 바라는 장면이군요.",
                "맞아. 내 손으로 붙잡는 연기는 영상에서 잘 전달됐어?", List.of("explain", "clarify"), true),
            new Scenario("ambiguous-correction", "이 대사는 상대가 떠나지 않기를 바라는 말일 수 있어요.",
                "내가 실수로 말했어.", List.of("clarify", "correct"), true),
            new Scenario("inner-monologue", "상대에게 가지 말라고 하는 이유가 무엇인가요?",
                "떠난 사람을 떠올리며 혼잣말하는 장면이에요. 실제 상대는 없어요. 어떻게 연기할지 하나만 알려줘요.", List.of("suggest"), false)
        );
    }

    @ParameterizedTest(name = "{0}") @MethodSource("scenarios")
    void respondsToCurrentNeed(Scenario scenario) throws Exception {
        var record = StructuredJson.resource("/coaching/record.json");
        var session = new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                record, "", "", "", 8000, "그 외", "그 외", null, List.of(), "", null, "open", "",
                List.of(new CoachTurnSnapshot("ai", scenario.previous())))
                .withCoachingState("three_layers_v1", 0, null, "open", "");
        var failures = new RecordingFailureReporter();
        var output = StructuredJson.MAPPER.createObjectNode().put("case", scenario.name()).put("semantic_review", "pending");
        output.put("previous", scenario.previous()).put("actor", scenario.actor());
        var calls = output.putArray("calls");
        var client = new OpenAiResponsesClient(StructuredJson.MAPPER);
        var engine = new CoachEngine((system, input) -> {
            var call = calls.addObject();
            call.set("input", StructuredJson.parse(input));
            var generated = client.generate(system, input);
            call.put("model", generated.model()).put("output", generated.text());
            return generated;
        }, failures, new RecordingLlmTelemetry());
        Path dir = Path.of("build", "response-selection-eval");
        Files.createDirectories(dir);
        try {
            var result = engine.reply(session, scenario.actor(), UUID.randomUUID());
            output.put("message", result.reply().message());
            output.set("state", result.session().coachingState());
            assertThat(result.reply().message()).doesNotContain("지금은 이 구간을 더 확인하기 어려워요", "기대답변", "known_refs");
            assertThat(result.session().coachingState().path("last_reply").path("move").asText()).isIn(scenario.moves());
            if (scenario.name().equals("correct-premise")) {
                // Correcting the premise and immediately helping from the corrected goal is also valid.
                // Check the retained goal, not just the model's routing label.
                assertThat(result.session().coachingState().path("context").path("scene_context")
                        .path("character_goal").path("text").asText()).contains("지갑", "돌려받");
                assertThat(result.reply().message()).contains("지갑").doesNotContain("헤어지기 싫어서", "이별을 막기 위해");
            }
            if (!scenario.questionAllowed()) assertThat(OpeningQuestion.questionCount(result.reply().message())).isZero();
            // A coach may acknowledge its mistaken premise before asking what the actor meant.
            // The routing label alone is not enough: ambiguity must still receive a real question.
            if (scenario.name().equals("ambiguous-correction")) {
                assertThat(OpeningQuestion.questionCount(result.reply().message())).isEqualTo(1);
                assertThat(result.session().coachingState().path("last_reply").path("selection").path("question").isNull()).isFalse();
            }
            if (scenario.name().equals("stop")) assertThat(result.session().status()).isEqualTo("closed");
            if (scenario.name().equals("missing-hand-observation")) {
                assertThat(result.reply().message()).doesNotContain("눈썹", "얼굴", "마음은", "목소리");
                assertThat(result.reply().message()).contains("손");
            }
        } finally {
            var errors = output.putArray("errors");
            failures.reports().forEach(report -> errors.add(report.failure().getMessage()));
            StructuredJson.MAPPER.writerWithDefaultPrettyPrinter().writeValue(dir.resolve(scenario.name() + ".json").toFile(), output);
        }
    }
}
