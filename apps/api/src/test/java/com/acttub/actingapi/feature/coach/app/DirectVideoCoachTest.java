package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import com.acttub.actingapi.feature.coach.domain.CoachTurnSnapshot;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;

class DirectVideoCoachTest {
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final TextGenerator oldGenerator = mock(TextGenerator.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    final DirectVideoModel.Video file = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");
    final List<Path> temporary = new ArrayList<>();
    final DirectVideoCoach direct = new DirectVideoCoach(model, videos, storage, failures, telemetry);
    final CoachEngine engine = new CoachEngine(oldGenerator, failures, telemetry, Optional.of(direct));

    DirectVideoCoachTest() {
        when(videos.find(any(), any())).thenReturn(new CoachVideoSource.Video("owned/video.mp4", "video/mp4", "etag"));
        when(storage.downloadToPath(eq("owned/video.mp4"), any())).thenAnswer(call -> {
            Path path = call.getArgument(1);
            temporary.add(path);
            Files.writeString(path, "original video bytes");
            return new StoredObjectMetadata(20, "video/mp4", "\"etag\"");
        });
        when(model.upload(any(), eq("video/mp4"))).thenAnswer(call -> {
            assertThat(Files.readString(call.getArgument(0))).isEqualTo("original video bytes");
            return file;
        });
        when(model.ready(file)).thenReturn(true);
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("말끝을 가볍게 던진 선택이 보여요. 장난스럽게 겁주려는 건가요?");
    }

    CoachSessionSnapshot session() {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "", "", "", 8000, "그 외", "그 외", null,
                List.of(), "", null, "open", "", List.of()).withCoachingState("three_layers_v1", 0, null, "open", "");
    }

    @Test void existingEngineUsesOnlyVideoPromptAndPersistedConversation() {
        var initial = session();
        var first = engine.start(initial, UUID.randomUUID());
        verify(videos).find(initial.userId(), initial.practiceSessionId());
        verify(model).reply(file, List.of(), DirectVideoPrompts.common());
        assertThat(first.session().turns()).containsExactly(new CoachTurnSnapshot("ai", first.reply().message()));
        assertThat(first.session().stateRevision()).isEqualTo(1);
        var second = engine.reply(first.session(), "장난스럽게 겁주려는 거야", UUID.randomUUID());
        verify(model).reply(file, List.of(new DirectVideoModel.Message("model", first.reply().message()),
                new DirectVideoModel.Message("user", "장난스럽게 겁주려는 거야")), DirectVideoPrompts.common());
        assertThat(second.session().stateRevision()).isEqualTo(2);
        assertThat(second.session().turns()).hasSize(3);
        assertThat(second.session().coachingState().path("context").path("direction").isNull()).isTrue();
        verifyNoInteractions(oldGenerator);
        verify(model, never()).classify(any(), anyList(), anyString());
        verify(model, times(2)).delete(file);
        assertThat(temporary).allSatisfy(path -> assertThat(path).doesNotExist());
        assertThat(telemetry.calls()).hasSize(2);
    }

    @Test void explicitEndPreservesExistingHandoffAndNoteContract() {
        var first = engine.start(session(), UUID.randomUUID());
        var end = engine.reply(first.session(), "그만", UUID.randomUUID());
        assertThat(end.reply().status()).isEqualTo("complete");
        assertThat(end.session().closeReason()).isEqualTo("actor_finished");
        StructuredJson.validate("coach_handoff_v2", end.reply().handoff());
        assertThat(end.reply().handoff().path("record_ref").isNull()).isTrue();
        assertThat(end.reply().handoff().path("conversation")).hasSize(3);
        var reports = new com.acttub.actingapi.feature.report.app.ReportEngine(
                (prompt, input) -> { throw new IllegalStateException("note generation unavailable"); },
                StructuredJson.MAPPER, telemetry);
        var note = reports.generateReport("coaching", end.session().observationPack(), end.reply().handoff(),
                false, UUID.randomUUID().toString(), null, null);
        assertThat(note.path("schema_version").asText()).isEqualTo("acttub.practice_note.v1");
    }

    @Test void tenthReplyClosesAtExistingTurnBudget() {
        var turns = new ArrayList<CoachTurnSnapshot>();
        for (int i = 0; i < 9; i++) turns.add(new CoachTurnSnapshot("ai", "이전 코칭 " + i));
        var result = engine.reply(session().withTurns(turns), "알겠어", UUID.randomUUID());
        assertThat(result.session().closeReason()).isEqualTo("turn_budget");
        assertThat(result.reply().status()).isEqualTo("complete");
    }

    @Test void unavailableReplyDoesNotMutateHistoryAndCleansMedia() {
        var initial = session();
        when(model.reply(any(), anyList(), anyString())).thenThrow(new IllegalStateException("provider failed"));
        assertThatThrownBy(() -> engine.reply(initial, "겁주려는 거야", UUID.randomUUID()))
                .isInstanceOf(CoachReplyUnavailable.class);
        assertThat(initial.turns()).isEmpty();
        assertThat(initial.stateRevision()).isZero();
        verify(model).delete(file);
        assertThat(temporary).allSatisfy(path -> assertThat(path).doesNotExist());
        assertThat(failures.reports()).anyMatch(report -> report.context().startsWith("DirectVideoCoach.turn"));
    }

    @Test void changedOrUnavailableOwnedMediaNeverReachesGemini() {
        when(storage.downloadToPath(anyString(), any())).thenReturn(new StoredObjectMetadata(20, "video/mp4", "changed"));
        assertThatThrownBy(() -> engine.start(session(), UUID.randomUUID())).isInstanceOf(CoachReplyUnavailable.class);
        when(videos.find(any(), any())).thenReturn(null);
        assertThatThrownBy(() -> engine.start(session(), UUID.randomUUID())).isInstanceOf(CoachReplyUnavailable.class);
        verify(model, never()).upload(any(), anyString());
    }

    @Test void failedProcessingAndCleanupAreReportedWithoutLosingSuccessfulReply() {
        when(model.ready(file)).thenThrow(new IllegalStateException("processing failed"));
        assertThatThrownBy(() -> engine.start(session(), UUID.randomUUID())).isInstanceOf(CoachReplyUnavailable.class);
        verify(model).delete(file);
        doReturn(true).when(model).ready(file);
        doThrow(new IllegalStateException("delete failed")).when(model).delete(file);
        assertThat(engine.start(session(), UUID.randomUUID()).reply().message()).isNotBlank();
        assertThat(failures.reports()).anyMatch(report -> report.context().startsWith("DirectVideoCoach.turn"))
                .anyMatch(report -> report.context().startsWith("DirectVideoCoach.delete"));
    }
}
