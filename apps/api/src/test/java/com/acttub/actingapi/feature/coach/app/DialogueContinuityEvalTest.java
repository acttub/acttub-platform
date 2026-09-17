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

/** Invented contract scene. Never sends private actor conversations to the model. */
@EnabledIfEnvironmentVariable(named = "ACTTUB_COACH_EVAL", matches = "1")
@EnabledIfEnvironmentVariable(named = "OPENAI_API_KEY", matches = ".+")
class DialogueContinuityEvalTest {
    @Test void repeatedConfusionAndCurrentPartnerCorrection() throws Exception {
        evaluate("repair-chain", List.of("무슨 이야기?", "그 이야기가 왜?", "계약서를 잘못 썼어", "무슨 질문이야 이게",
                "상대가 급하게 계약하려고 해서", "아니 지금 상대가 확인 안 하고 계약하려 해서 예전 친구 이야기를 꺼낸 거야",
                "ㅇㅇ", "ㅇㅇ", "ㅇㅇ 어쩌라고"));
    }
    @Test void aCauseIsAcceptedBeforeAskingForTheDesiredResult() throws Exception {
        evaluate("cause-to-goal", List.of("상대가 급하게 계약하려고 해서", "서명하기 전에 조건을 다시 확인하게 하고 싶어",
                "ㅇㅇ", "ㅇㅇ", "그만"));
    }
    @Test void aDeniedInterpretationDoesNotReturnAfterAcknowledgement() throws Exception {
        evaluate("denial-target", List.of("계약을 막는 게 아니라 내용을 먼저 확인시키려는 거예요",
                "마지막 그런 뜻은 아니라는 건 상대가 내가 겁준다고 오해해서 하는 말이에요",
                "ㅇㅇ", "ㅇㅇ", "그럼 어떻게 하면 돼?", "그만"));
    }
    @Test void confusionAfterAnExplanationGetsHelpInsteadOfAnotherRephrasing() throws Exception {
        evaluate("repair-twice", List.of("질문이 무슨 말이야?", "아직도 무슨 질문인지 모르겠어", "설명해도 모르겠어",
                "상대가 급하게 계약하려고 해서", "그래서 어쩌라고", "그만"));
    }

    private void evaluate(String name, List<String> replies) throws Exception {
        ObjectNode chunk = (ObjectNode) StructuredJson.resource("/coaching/chunk.json").deepCopy();
        var utterances = chunk.putArray("utterances");
        var events = chunk.putArray("events");
        var segments = chunk.putArray("segments");
        chunk.putArray("limitations");
        String[] lines = {"예전에 내 친구도 급하게 계약했어.", "조건을 안 읽고 사인했다가 보증금을 못 돌려받았어.", "그런 뜻은 아니야."};
        for (int i = 0; i < 3; i++) {
            utterances.addObject().put("id", "u" + i).put("speaker_id", "p1")
                    .put("start_ms", i * 4000).put("end_ms", i * 4000 + 3000)
                    .put("text", lines[i]).put("transcription_status", "clear").put("timing_basis", "estimated");
            var event = events.addObject().put("id", "e" + i).put("subject_id", "p1")
                    .put("start_ms", i * 4000).put("end_ms", i * 4000 + 3000)
                    .put("channel", "audio").put("dimension", "rhythm").put("clarity", "clear")
                    .put("timing_basis", "estimated").put("description", "문장의 단어들이 일정한 속도로 이어 들린다.");
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
        var output = StructuredJson.MAPPER.createObjectNode().put("case", name).put("semantic_review", "pending");
        var messages = output.putArray("messages");
        var calls = output.putArray("calls");
        var client = new OpenAiResponsesClient(StructuredJson.MAPPER);
        var engine = new CoachEngine((system, input) -> {
            var generated = client.generate(system, input);
            calls.addObject().put("model", generated.model()).put("output", generated.text());
            return generated;
        }, failures, new RecordingLlmTelemetry());
        Path dir = Path.of("build", "dialogue-continuity-eval");
        Files.createDirectories(dir);
        try {
            var result = engine.start(session, UUID.randomUUID());
            messages.addObject().put("role", "ai").put("text", result.reply().message());
            int ack = 0;
            for (String actor : replies) {
                assertThat(result.session().status()).as("keep helping until actor finishes the scenario").isEqualTo("open");
                messages.addObject().put("role", "actor").put("text", actor);
                result = engine.reply(result.session(), actor, UUID.randomUUID());
                String message = result.reply().message();
                messages.addObject().put("role", "ai").put("text", message);
                assertThat(message).doesNotContain("지금은 이 구간을 더 확인하기 어려워요", "제가 묻는 건", "그건 그 경험의 내용");
                if (actor.equals("상대가 급하게 계약하려고 해서")) {
                    assertThat(result.session().coachingState().path("context").path("scene_context").toString()).contains("상대가 급하게 계약하려고 해서");
                    assertThat(message).doesNotMatch("(?s).*왜.{0,25}(?:이야기|꺼냈|꺼내).*");
                }
                ack = actor.equals("ㅇㅇ") ? ack + 1 : 0;
                if (ack >= 2) assertThat(result.session().coachingState().path("last_reply").path("move").asText()).isNotEqualTo("acknowledge");
                if (actor.contains("어쩌라고")) assertThat(message).doesNotContain("카메라", "목소리에 힘", "정면");
            }
            output.set("state", result.session().coachingState());
            assertThat(result.session().status()).isEqualTo("closed");
        } finally {
            var errors = output.putArray("errors");
            failures.reports().forEach(report -> errors.add(report.failure().getMessage()));
            StructuredJson.MAPPER.writerWithDefaultPrettyPrinter().writeValue(dir.resolve(name + ".json").toFile(), output);
        }
    }
}
