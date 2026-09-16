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

/** Synthetic records only. Passing structural assertions does not establish semantic quality. */
@EnabledIfEnvironmentVariable(named = "ACTTUB_COACH_EVAL", matches = "1")
@EnabledIfEnvironmentVariable(named = "OPENAI_API_KEY", matches = ".+")
class WholeVideoOpeningEvalTest {
    @Test void oneRepeatedIssueAcrossThreeUtterances() throws Exception {
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
                    .put("timing_basis", "estimated").put("description", "문장 앞부분은 뚜렷하지만 끝 두 음절에서 소리가 작아져 알아듣기 어렵다.");
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
        var engine = new CoachEngine(new OpenAiResponsesClient(StructuredJson.MAPPER), new RecordingFailureReporter(), new RecordingLlmTelemetry());
        var result = engine.start(session, UUID.randomUUID());
        var output = StructuredJson.MAPPER.createObjectNode().put("message", result.reply().message()).put("semantic_review", "pending");
        output.set("focus", result.session().coachingState().path("context").path("focus"));
        Path dir = Path.of("build", "whole-video-eval"); Files.createDirectories(dir);
        StructuredJson.MAPPER.writerWithDefaultPrettyPrinter().writeValue(dir.resolve("opening.json").toFile(), output);
        assertThat(output.path("focus").path("scope").asText()).isEqualTo("whole_video");
        assertThat(output.path("focus").path("pattern").asText()).isEqualTo("recurring");
        assertThat(OpeningQuestion.questionCount(result.reply().message())).isEqualTo(1);
    }
}
