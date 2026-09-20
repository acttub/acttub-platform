package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.integration.llm.OpenAiResponsesClient;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/** Explicit opt-in only; all material here is the checked-in synthetic fixture. */
@EnabledIfEnvironmentVariable(named = "ACTTUB_ROUTE_LIVE_TEST", matches = "1")
@EnabledIfEnvironmentVariable(named = "OPENAI_API_KEY", matches = ".+")
class CoachingPipelineLiveTest {
    @Test void syntheticConversationExercisesAllStagesAndFinalHandoff() throws Exception {
        var failures = new RecordingFailureReporter();
        var telemetry = new RecordingLlmTelemetry();
        var engine = new CoachEngine(new OpenAiResponsesClient(StructuredJson.MAPPER), failures, telemetry, true);
        var transcript = new ArrayList<String>();
        var session = CoachingPipelineTest.session();
        CoachResult result = engine.start(session, UUID.randomUUID());
        transcript.add("AI: " + result.reply().message());
        for (String actor : List.of("상대가 떠나는 걸 막으려고 하는 말이에요.", "영상에서는 그 의도가 어떻게 보여요?",
                "그럼 상대를 붙잡으려면 어떻게 말하면 될까요?", "방금 해보니 덜 급해졌는데 상대를 붙잡는 느낌은 약해졌어요.", "여기까지 할게요")) {
            transcript.add("ACTOR: " + actor);
            result = engine.reply(result.session(), actor, UUID.randomUUID());
            transcript.add("AI: " + result.reply().message());
            assertThat(result.reply().message()).isNotBlank().doesNotContain("source_refs", "understand_scene", "{\"message\"");
        }
        Files.createDirectories(Path.of("build/route-eval"));
        Files.writeString(Path.of("build/route-eval/synthetic-conversation.txt"), String.join("\n\n", transcript));
        assertThat(result.reply().status()).isEqualTo("complete");
        StructuredJson.validate("coach_handoff_v2", result.reply().handoff());
        assertThat(result.reply().handoff().path("conversation")).hasSize(11);
    }
}
