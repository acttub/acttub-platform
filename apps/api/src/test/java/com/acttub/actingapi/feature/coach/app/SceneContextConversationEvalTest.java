package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.integration.llm.OpenAiResponsesClient;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.observation.ActorMaterial;
import com.acttub.actingapi.integration.observation.VideoRecord;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/** Entirely fictional material. Structural assertions require a separate semantic transcript review. */
@EnabledIfEnvironmentVariable(named = "ACTTUB_COACH_EVAL", matches = "1")
@EnabledIfEnvironmentVariable(named = "OPENAI_API_KEY", matches = ".+")
class SceneContextConversationEvalTest {
    @Test void correctsScenePurposeAndGivesFeedbackWithoutAPracticeGoal() throws Exception {
        evaluate("purpose-correction", List.of("상대가 집을 나가려 해서 붙잡는 거예요.",
                "아니, 못 나가게 하려는 건 아니고 열쇠를 돌려받으려는 거예요.", "그래서 어떻게 하면 돼?", "여기까지"));
    }

    @Test void confusionAndDemandForFeedbackDoNotLoopOnObservations() throws Exception {
        evaluate("confusion-help", List.of("모르겠어", "뭔 소리야?", "그래서 뭐 어쩌라고", "그만"));
    }

    @Test void unknownReasonStaysWithSceneAnalysisBeforeDelivery() throws Exception {
        evaluate("analysis-unknown", List.of("ㅁㄹ", "상대가 이제 자기 집으로 돌아가겠다고 했어요.",
                "상대는 헤어진 연인이고 내 집 열쇠를 아직 갖고 있어요. 나가는 건 괜찮지만 열쇠는 돌려받으려는 거예요.", "여기까지"));
    }

    @Test void clearAnalysisCanProceedToDeliveryWithoutRepeatingBasics() throws Exception {
        evaluate("analysis-ready", List.of(
                "헤어진 연인에게 말해요. 상대가 자기 집으로 돌아간다고 해서, 내 집 열쇠를 돌려받으려고요. 지난번에는 그냥 가버렸어요. 붙잡는 게 아니라 이번에는 돌려달라고 요구하는 거예요.",
                "그래서 지금 연기에서는 그 요구가 어떻게 들려요?", "여기까지"));
    }

    private void evaluate(String name, List<String> replies) throws Exception {
        ObjectNode chunk = (ObjectNode) StructuredJson.resource("/coaching/chunk.json").deepCopy();
        var utterances = chunk.putArray("utterances");
        var events = chunk.putArray("events");
        var segments = chunk.putArray("segments");
        chunk.putArray("limitations");
        // Different scene from the prompt example and from all private user records.
        String[] lines = {"아직 네 짐이 여기 있잖아.", "지난번에도 그냥 갔지.", "열쇠는 놓고 가."};
        String[] observations = {"첫 문장은 일정한 속도로 말하고 상대가 있는 화면 오른쪽을 본다.",
                "두 번째 문장도 같은 속도로 이어 말한다. 말하는 동안 시선은 화면 오른쪽에 머문다.",
                "잠깐 멈춘 뒤 마지막 문장을 짧게 끊어 말한다. 음량은 앞보다 작지만 모든 단어가 들린다."};
        for (int i = 0; i < 3; i++) {
            utterances.addObject().put("id", "u" + i).put("speaker_id", "p1")
                    .put("start_ms", i * 4000).put("end_ms", i * 4000 + 3000)
                    .put("text", lines[i]).put("transcription_status", "clear").put("timing_basis", "estimated");
            var event = events.addObject().put("id", "e" + i).put("subject_id", "p1")
                    .put("start_ms", i * 4000).put("end_ms", i * 4000 + 3000)
                    .put("channel", "audio").put("dimension", "rhythm").put("clarity", "clear")
                    .put("timing_basis", "estimated").put("description", observations[i]);
            event.putArray("utterance_ids").add("u" + i);
            var segment = segments.addObject().put("id", "s" + i).put("start_ms", i * 4000).put("end_ms", (i + 1) * 4000);
            segment.putArray("utterance_ids"); segment.putArray("event_ids"); segment.putArray("limitation_ids");
            segment.putObject("channel_status").put("audio", "recorded").put("visual", "recorded");
        }
        var record = VideoRecord.empty(UUID.randomUUID(), 12000, true, new ActorMaterial("", "", "", "그 외", "", 12000));
        VideoRecord.append(record, VideoRecord.prepareChunk(chunk, chunk.path("chunk_id").asText(), 12000), 0);
        VideoRecord.finish(record, null);
        var session = new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                record, "", "", "", 12000, "그 외", "그 외", null, List.of(), "", null, "open", "", List.of())
                .withCoachingState("three_layers_v1", 0, null, "open", "");
        var failures = new RecordingFailureReporter();
        var output = StructuredJson.MAPPER.createObjectNode().put("semantic_review", "pending");
        var messages = output.putArray("messages");
        var calls = output.putArray("calls");
        var client = new OpenAiResponsesClient(StructuredJson.MAPPER);
        var engine = new CoachEngine((system, input) -> {
            var call = calls.addObject();
            call.set("input", StructuredJson.parse(input));
            var generated = client.generate(system, input);
            call.put("output", generated.text());
            return generated;
        }, failures, new RecordingLlmTelemetry());
        Path dir = Path.of("build", "scene-context-eval");
        Files.createDirectories(dir);
        try {
            var result = engine.start(session, UUID.randomUUID());
            messages.addObject().put("role", "ai").put("text", result.reply().message());
            assertThat(result.reply().message().length()).isLessThanOrEqualTo(100);
            assertThat(result.reply().message()).doesNotContain("영상에 근거한 설명을 준비하지 못했어요");
            for (String reply : replies) {
                assertThat(result.session().status()).isEqualTo("open");
                messages.addObject().put("role", "actor").put("text", reply);
                result = engine.reply(result.session(), reply, UUID.randomUUID());
                messages.addObject().put("role", "ai").put("text", result.reply().message());
                assertThat(result.reply().message()).doesNotContain("지금은 이 구간을 더 확인하기 어려워요", "기대답변");
                if (name.equals("analysis-unknown") && (reply.equals(replies.get(0)) || reply.equals(replies.get(1)))) {
                    // In this fixture, neither uncertainty nor the preceding event explains the speaker's reason.
                    assertThat(OpeningQuestion.questionCount(result.reply().message())).isLessThanOrEqualTo(1);
                    assertThat(result.reply().message()).doesNotContain("단호", "음량", "목소리", "속도", "짧게 끊");
                }
                if (reply.equals("ㅁㄹ") || reply.equals("모르겠어") || reply.equals("뭔 소리야?")) {
                    assertThat(result.session().coachingState().path("last_reply").path("move").asText())
                            .isIn("explain", "clarify", "simplify");
                    assertThat(result.reply().message()).doesNotContain("말해보세요", "기다려보세요", "잡아보세요", "기다리세요");
                }
                // An in-scene objective must not silently become the actor's training goal.
                assertThat(result.session().coachingState().path("context").path("direction").isNull()).isTrue();
            }
            assertThat(result.session().status()).isEqualTo("closed");
            output.set("state", result.session().coachingState());
        } finally {
            var errors = output.putArray("errors");
            failures.reports().forEach(report -> errors.add(report.failure().getMessage()));
            StructuredJson.MAPPER.writerWithDefaultPrettyPrinter().writeValue(dir.resolve(name + ".json").toFile(), output);
        }
    }
}
