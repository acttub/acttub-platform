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
import com.acttub.actingapi.feature.report.app.ReportEngine;
import com.acttub.actingapi.feature.report.app.PracticeNote;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/** Synthetic records only. Passing structural assertions does not establish semantic quality. */
@EnabledIfEnvironmentVariable(named = "ACTTUB_COACH_EVAL", matches = "1")
@EnabledIfEnvironmentVariable(named = "OPENAI_API_KEY", matches = ".+")
class WholeVideoOpeningEvalTest {
    @Test void oneRepeatedIssueAcrossThreeUtterances() throws Exception {
        evaluate("improvement", "문장 앞부분은 뚜렷하지만 끝 두 음절에서 소리가 작아져 알아듣기 어렵다.",
                List.of("끝말이 작아진 건 몰랐어. 장면 전체에서 내 말을 끝까지 전하고 싶어.",
                        "소리를 지르고 싶은 건 아니고, 마지막 말까지 들리게 하고 싶어.", "여기까지 정리해줘"));
    }

    @Test void extendsEffectiveDeliveryWithoutInventingAFlaw() throws Exception {
        evaluate("strength", "문장 처음부터 마지막 음절까지 말소리가 또렷하게 들린다. 소리를 지르거나 끝말을 늘이지 않는다.",
                List.of("상대에게 말을 끝까지 건네는 느낌이 편했어. 이걸 다른 장면에서도 쓰고 싶어.",
                        "다음에도 이 장면으로 할게. 말은 또렷하게 하되 세 문장을 똑같이 말하고 싶지는 않아.", "여기까지 정리해줘"));
    }

    @Test void experienceAloneDoesNotBecomeAGoalBeforeTheActorChooses() throws Exception {
        evaluate("experience", "문장 처음부터 마지막 음절까지 말소리가 또렷하게 들린다. 소리를 지르거나 끝말을 늘이지 않는다.",
                List.of("상대에게 말을 끝까지 건네는 느낌이 편했어.",
                        "그 느낌은 유지하고 싶어. 이 장면에서 세 문장을 똑같이 말하지 않으면서 끝까지 전달하고 싶어.",
                        "여기까지 정리해줘"));
    }

    @Test void experienceCanEndWithoutAGoalAndStillAppearInTheNote() throws Exception {
        evaluate("experience-only", "문장 처음부터 마지막 음절까지 말소리가 또렷하게 들린다.",
                List.of("상대에게 말을 끝까지 건네는 느낌이 편했어.", "여기까지 정리해줘"));
    }

    @Test void denialConfusionAndUncertaintyDoNotForceAGoal() throws Exception {
        evaluate("confusion", "문장 앞부분은 뚜렷하지만 끝 두 음절에서 소리가 작아져 알아듣기 어렵다.",
                List.of("아니지", "뭐라는 거야?", "모르겠어", "여기까지 정리해줘"));
    }

    private void evaluate(String name, String observation, List<String> answers) throws Exception {
        ObjectNode chunk = (ObjectNode) StructuredJson.resource("/coaching/chunk.json").deepCopy();
        var utterances = chunk.putArray("utterances");
        var events = chunk.putArray("events");
        var segments = chunk.putArray("segments");
        chunk.putArray("limitations");
        String[] texts = {"잠깐 기다려줘", "할 말이 남았어", "내 얘기 끝까지 들어줘"};
        for (int i = 0; i < 3; i++) {
            utterances.addObject().put("id", "u" + i).put("speaker_id", "p1")
                    .put("start_ms", i * 4000).put("end_ms", i * 4000 + 3000)
                    .put("text", texts[i]).put("transcription_status", "clear").put("timing_basis", "estimated");
            var event = events.addObject().put("id", "e" + i).put("subject_id", "p1")
                    .put("start_ms", i * 4000).put("end_ms", i * 4000 + 3000)
                    .put("channel", "audio").put("dimension", "voice").put("clarity", "clear")
                    .put("timing_basis", "estimated").put("description", observation);
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
        var calls = StructuredJson.MAPPER.createArrayNode();
        var client = new OpenAiResponsesClient(StructuredJson.MAPPER);
        var engine = new CoachEngine((system, input) -> {
            var call = calls.addObject();
            call.set("input", StructuredJson.parse(input));
            var generated = client.generate(system, input);
            call.put("output", generated.text());
            return generated;
        }, failures, new RecordingLlmTelemetry());
        var result = engine.start(session, UUID.randomUUID());
        var output = StructuredJson.MAPPER.createObjectNode().put("message", result.reply().message()).put("semantic_review", "pending");
        output.set("focus", result.session().coachingState().path("context").path("focus"));
        output.set("coach_calls", calls);
        var openingErrors = output.putArray("opening_errors");
        failures.reports().forEach(report -> openingErrors.add(report.failure().getMessage()));
        Path dir = Path.of("build", "whole-video-eval", name); Files.createDirectories(dir);
        StructuredJson.MAPPER.writerWithDefaultPrettyPrinter().writeValue(dir.resolve("opening.json").toFile(), output);
        assertThat(output.path("focus").path("scope").asText()).isEqualTo("whole_video");
        assertThat(output.path("focus").path("pattern").asText()).isEqualTo("recurring");
        assertThat(OpeningQuestion.questionCount(result.reply().message())).isLessThanOrEqualTo(1);
        var messages = output.putArray("conversation");
        messages.addObject().put("role", "ai").put("text", result.reply().message());
        try {
            for (String answer : answers) {
                if ("closed".equals(result.session().status())) break;
                messages.addObject().put("role", "actor").put("text", answer);
                result = engine.reply(result.session(), answer, UUID.randomUUID());
                messages.addObject().put("role", "ai").put("text", result.reply().message());
                if (name.equals("experience") && answer.equals(answers.get(0))) {
                    assertThat(result.session().coachingState().path("context").path("direction").isNull()).isTrue();
                }
                assertThat(DialogueState.asksToSelectPassage(result.reply().message())).isFalse();
                assertThat(DialogueState.presentsExperienceAsObservation(result.reply().message())).isFalse();
                assertThat(result.reply().message()).doesNotContain("지금은 이 구간을 더 확인하기 어려워요",
                        "영상에 근거한 설명을 준비하지 못했어요", "기대답변");
            }
            assertThat(result.session().status()).isEqualTo("closed");
            assertThat(result.reply().handoff()).isNotNull();
            output.set("handoff", result.reply().handoff());
            var reportCalls = output.putArray("report_calls");
            var reportClient = new OpenAiResponsesClient(StructuredJson.MAPPER);
            var reports = new ReportEngine((system, input) -> {
                var call = reportCalls.addObject();
                call.set("input", StructuredJson.parse(input));
                var generated = reportClient.generate(system, input);
                call.put("output", generated.text());
                return generated;
            },
                    StructuredJson.MAPPER, new RecordingLlmTelemetry());
            var note = reports.generateReport("coaching", null, result.reply().handoff(), false, "synthetic", null, null);
            output.set("note", note);
            output.set("visible_note", PracticeNote.publicView(note));
            if (!name.equals("confusion")) assertThat(note.path("focus").path("scope").asText()).isEqualTo("whole_video");
            if (name.equals("confusion") || name.equals("experience-only")) {
                assertThat(note.path("direction").isNull()).isTrue();
                assertThat(note.path("practice").isNull()).isTrue();
                if (name.equals("experience-only")) {
                    assertThat(PracticeNote.publicView(note).path("summary").asText()).contains("편했어");
                }
            } else assertThat(note.path("practice").isObject()).isTrue();
            assertThat(note.path("attempts")).isEmpty();
        } finally {
            output.set("coach_calls", calls);
            var errors = output.putArray("coach_errors");
            failures.reports().forEach(report -> errors.add(report.failure().getMessage()));
            StructuredJson.MAPPER.writerWithDefaultPrettyPrinter().writeValue(dir.resolve("conversation-note.json").toFile(), output);
        }
    }
}
