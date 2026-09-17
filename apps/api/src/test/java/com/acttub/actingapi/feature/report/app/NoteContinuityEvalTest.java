package com.acttub.actingapi.feature.report.app;

import static org.assertj.core.api.Assertions.assertThat;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import com.acttub.actingapi.integration.llm.OpenAiResponsesClient;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Real dev text model, synthetic handoffs only. Saved notes require semantic review. */
@EnabledIfEnvironmentVariable(named = "ACTTUB_COACH_EVAL", matches = "1")
@EnabledIfEnvironmentVariable(named = "OPENAI_API_KEY", matches = ".+")
class NoteContinuityEvalTest {
    record Scenario(String name, ObjectNode handoff, boolean practice, List<String> forbidden) { }

    static Stream<Scenario> scenarios() {
        var accepted = NoteContinuityFixtures.scene();
        NoteContinuityFixtures.message(accepted, "advice", "ai", "열쇠를 받기 전에는 요구를 접지 않고 끝까지 돌려달라고 해보세요.");
        NoteContinuityFixtures.message(accepted, "accept", "actor", "좋아요. 열쇠를 받기 전에는 요구를 접지 않는 걸로 해볼게요. 정리해줘요.");
        var rejected = NoteContinuityFixtures.scene();
        NoteContinuityFixtures.message(rejected, "reject", "actor", "연습 방법은 제안하지 말고, 오늘 정리한 뜻만 남겨줘요.");
        var unknown = NoteContinuityFixtures.scene();
        ((ObjectNode) unknown.path("context").path("scene_context")).putNull("character_goal");
        NoteContinuityFixtures.message(unknown, "unknown", "actor", "아직 왜 이 말을 하는지 모르겠어요. 오늘은 여기까지 할게요.");
        var corrected = NoteContinuityFixtures.scene();
        NoteContinuityFixtures.message(corrected, "correct", "actor", "아니, 열쇠를 받으려는 것도 아니에요. 목적을 아직 모르겠어요. 끝낼게요.");
        var failed = NoteContinuityFixtures.scene();
        failed.put("end_reason", "system_failure");
        var strength = delivery("말끝을 길게 이어 부탁하는 선택이 좋아요. 그걸 유지하고 싶어요.",
                "‘줘’의 소리를 앞 음절보다 길게 이어 말한다.");
        var hiddenHands = delivery("손으로 열쇠를 달라는 뜻을 전하고 싶어요.", "고개가 정면을 향한다.");
        NoteContinuityFixtures.source(hiddenHands, "hands-limit", "record_limitation", "손은 영상 내내 화면 밖이라 확인할 수 없다.", 0, 12000);
        NoteContinuityFixtures.message(hiddenHands, "hands", "actor", "이 영상의 손동작을 근거로 고칠 점을 정리해줘요.");
        return Stream.of(
            new Scenario("scene-goal", NoteContinuityFixtures.scene(), true, List.of("음량", "시선", "호흡", "말끝")),
            new Scenario("accepted-advice", accepted, true, List.of("2초", "시선", "호흡")),
            new Scenario("no-method-request", rejected, false, List.of()),
            new Scenario("unknown-goal", unknown, false, List.of()),
            new Scenario("stale-correction", corrected, false, List.of()),
            new Scenario("system-failure", failed, false, List.of()),
            new Scenario("maintain-strength", strength, true, List.of("짧게", "끊어", "문제", "부족")),
            new Scenario("offscreen-hands", hiddenHands, false, List.of())
        );
    }

    private static ObjectNode delivery(String direction, String observation) {
        var handoff = NoteContinuityFixtures.scene();
        NoteContinuityFixtures.message(handoff, "direction", "actor", direction);
        var context = (ObjectNode) handoff.path("context");
        context.putObject("direction").put("text", direction).put("origin", "actor_stated")
                .putArray("source_refs").add("direction");
        var focus = (ObjectNode) context.path("focus");
        focus.put("basis", "delivery").put("scope", "local").put("pattern", "isolated").put("label", direction);
        focus.putArray("evidence_refs").add("observed");
        NoteContinuityFixtures.source(handoff, "observed", "video_observation", observation, 7000, 11000);
        return handoff;
    }

    @ParameterizedTest(name = "{0}") @MethodSource("scenarios")
    void keepsTheActorsCurrentWorkInTheFinalNote(Scenario scenario) throws Exception {
        var client = new OpenAiResponsesClient(StructuredJson.MAPPER);
        var output = StructuredJson.MAPPER.createObjectNode().put("case", scenario.name()).put("semantic_review", "pending");
        output.set("handoff", scenario.handoff());
        var calls = output.putArray("calls");
        var errors = new ArrayList<RuntimeException>();
        Path directory = Path.of("build", "note-continuity-eval");
        Files.createDirectories(directory);
        try {
            var note = PracticeNote.assemble(scenario.handoff(), input -> {
                var generated = client.generate(PracticeNote.prompt(scenario.handoff()), input);
                calls.addObject().put("model", generated.model()).put("output", generated.text());
                return generated.text();
            }, errors::add);
            var visible = PracticeNote.publicView(note);
            output.set("note", visible);
            assertThat(errors).hasSizeLessThan(2); // Do not count a deterministic fallback as model success.
            assertThat(visible.path("practice").isObject()).isEqualTo(scenario.practice());
            if (scenario.practice()) {
                String instruction = visible.path("practice").path("instruction").asText();
                assertThat(instruction).isNotBlank();
                for (String word : scenario.forbidden()) assertThat(instruction).doesNotContain(word);
                assertThat(visible.path("practice").path("selection").asText()).isEqualTo("proposed");
            }
            assertThat(visible.path("attempts")).isEmpty();
        } finally {
            var failures = output.putArray("errors");
            errors.forEach(e -> failures.add(e.getMessage()));
            StructuredJson.MAPPER.writerWithDefaultPrettyPrinter().writeValue(directory.resolve(scenario.name() + ".json").toFile(), output);
        }
    }
}
