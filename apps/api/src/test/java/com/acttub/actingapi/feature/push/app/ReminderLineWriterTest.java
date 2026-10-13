package com.acttub.actingapi.feature.push.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;

class ReminderLineWriterTest {

    @Test void acceptsShortKoreanAction() {
        assertThat(ReminderLineWriter.accept("  상대가 흔들리는지 보면서 한 번 더 찍어 봐요. ", true))
                .contains("상대가 흔들리는지 보면서 한 번 더 찍어 봐요.");
        assertThat(ReminderLineWriter.accept("Drop the smile and hold your gaze on your partner. One more take?", false))
                .isPresent();
    }

    /** 잠금 화면에 띄우면 안 되는 모양은 모두 버린다 — 부르는 쪽이 고정 문구를 보낸다. */
    @Test void rejectsWhatShouldNotReachTheLockScreen() {
        assertThat(ReminderLineWriter.accept("SKIP", true)).isEmpty();
        assertThat(ReminderLineWriter.accept("skip", false)).isEmpty();
        assertThat(ReminderLineWriter.accept("", true)).isEmpty();
        assertThat(ReminderLineWriter.accept(null, true)).isEmpty();
        assertThat(ReminderLineWriter.accept("상대를 보며\n한 번 더 해 봐요.", true)).as("줄바꿈").isEmpty();
        assertThat(ReminderLineWriter.accept("\"적당히 좀 해라\"로 한 번 더 눌러 봐요.", true)).as("대사 인용").isEmpty();
        assertThat(ReminderLineWriter.accept("「적당히 좀 해라」로 눌러 봐요.", true)).as("낫표").isEmpty();
        assertThat(ReminderLineWriter.accept("오늘도 화이팅! 한 번 더 찍어 봐요.", true)).as("느낌표").isEmpty();
        assertThat(ReminderLineWriter.accept("상대".repeat(21), true)).as("41자").isEmpty();
        assertThat(ReminderLineWriter.accept("Hold your gaze. One more take?", true)).as("한국어 기기에 영어").isEmpty();
        assertThat(ReminderLineWriter.accept("상대를 보며 한 번 더.", false)).as("영어 기기에 한국어").isEmpty();
    }

    @Test void writesThroughModelAndRecordsTheCall() {
        RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
        TextGenerator model = (instructions, input) -> new GeneratedText("상대가 멈추는지 보면서 한 번 더 눌러 봐요.",
                new TokenUsage(10, 5, 15), "test-model");
        UUID practice = UUID.randomUUID();

        var line = new ReminderLineWriter(model, telemetry)
                .write(UUID.randomUUID(), practice, "후임이 갈구는 걸 멈추는지 보면서 \"적당히 좀 해라\"로 눌러요.", true);

        assertThat(line).contains("상대가 멈추는지 보면서 한 번 더 눌러 봐요.");
        assertThat(telemetry.calls()).singleElement().satisfies(call -> {
            assertThat(call.step()).isEqualTo(LlmStep.REMINDER_LINE);
            assertThat(call.practiceSessionId()).isEqualTo(practice);
            assertThat(call.metadata()).containsEntry("accepted", "true").containsEntry("language", "ko");
        });
    }

    @Test void modelFailureGivesEmptyAndIsRecorded() {
        RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
        TextGenerator broken = (instructions, input) -> { throw new IllegalStateException("down"); };

        var line = new ReminderLineWriter(broken, telemetry).write(UUID.randomUUID(), UUID.randomUUID(), "해 봐요", true);

        assertThat(line).isEmpty();
        assertThat(telemetry.calls()).singleElement().satisfies(call -> assertThat(call.failed()).isTrue());
    }

    @Test void blankNextTakeDoesNotCallModel() {
        RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
        TextGenerator never = (instructions, input) -> { throw new AssertionError("불리면 안 된다"); };
        assertThat(new ReminderLineWriter(never, telemetry).write(UUID.randomUUID(), UUID.randomUUID(), " ", true)).isEmpty();
        assertThat(telemetry.calls()).isEmpty();
    }
}
