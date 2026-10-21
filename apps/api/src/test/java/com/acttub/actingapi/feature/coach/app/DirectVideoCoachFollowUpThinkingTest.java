package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.observation.ReplyTrace;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;

/** SOMA-780: 연습 루프 답장은 생각을 최소로 요청하고, 첫 질문과 끄기 스위치(false)는 요청하지 않는다. */
class DirectVideoCoachFollowUpThinkingTest {
    static final String REPLY = "아, 그럼 그 장면에선 아빠한테 뭘 하려고 했어요?";
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    final DirectVideoModel.Video file = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");
    final List<Boolean> minimalRequests = new ArrayList<>();

    DirectVideoCoachFollowUpThinkingTest() {
        when(videos.find(any(), any())).thenReturn(new CoachVideoSource.Video("owned/video.mp4", "video/mp4", "etag"));
        when(storage.downloadToPath(eq("owned/video.mp4"), any())).thenAnswer(call -> {
            Path path = call.getArgument(1);
            Files.writeString(path, "original video bytes");
            return new StoredObjectMetadata(20, "video/mp4", "\"etag\"");
        });
        when(model.upload(any(), eq("video/mp4"))).thenReturn(file);
        when(model.ready(file)).thenReturn(true);
        when(model.model()).thenReturn("gemini-3-flash-preview");
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"answered\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenAnswer(call -> {
            minimalRequests.add(ReplyTrace.minimalRequested());
            return REPLY;
        });
    }

    DirectVideoCoach coach(boolean followUpMinimal) {
        return new DirectVideoCoach(model, videos, storage, failures, telemetry, true, CoachPersonas.NONE, null, 0,
                CoachFlows.NONE, CoachVideoCache.NONE, true, followUpMinimal);
    }

    @Test void aFollowUpReplyAsksForMinimalThinking() {
        coach(true).turn(DirectVideoCoachBranchTest.looped("버릇: 말끝", List.of(""), "a", "첫 질문"), "붙잡고 싶었어", UUID.randomUUID());
        assertThat(minimalRequests).containsExactly(true);
    }

    @Test void theFirstQuestionKeepsTheUsualThinking() {
        coach(true).turn(DirectVideoCoachBranchTest.looped("버릇: 말끝", List.of(""), "a"), "", UUID.randomUUID());
        assertThat(minimalRequests).containsExactly(false);
    }

    @Test void theSwitchTurnsMinimalThinkingOff() {
        coach(false).turn(DirectVideoCoachBranchTest.looped("버릇: 말끝", List.of(""), "a", "첫 질문"), "붙잡고 싶었어", UUID.randomUUID());
        assertThat(minimalRequests).containsExactly(false);
    }
}
