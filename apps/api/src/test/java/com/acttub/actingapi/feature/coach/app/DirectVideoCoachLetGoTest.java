package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;

/** SOMA-780: 정정에 답하는 '내려놓기'는 영상 없이 글만 보내 쓰고, 다른 답은 영상과 함께 쓴다. */
class DirectVideoCoachLetGoTest {
    static final String REPLY = "아, 그럼 그 장면에선 아빠한테 뭘 하려고 했어요?";
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    final DirectVideoModel.Video file = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");

    DirectVideoCoachLetGoTest() {
        when(videos.find(any(), any())).thenReturn(new CoachVideoSource.Video("owned/video.mp4", "video/mp4", "etag"));
        when(storage.downloadToPath(eq("owned/video.mp4"), any())).thenAnswer(call -> {
            Path path = call.getArgument(1);
            Files.writeString(path, "original video bytes");
            return new StoredObjectMetadata(20, "video/mp4", "\"etag\"");
        });
        when(model.upload(any(), eq("video/mp4"))).thenReturn(file);
        when(model.ready(file)).thenReturn(true);
        when(model.model()).thenReturn("gemini-3-flash-preview");
    }

    DirectVideoCoach coach(boolean letGoWithoutVideo) {
        return new DirectVideoCoach(model, videos, storage, failures, telemetry, true, CoachPersonas.NONE, null, 0,
                CoachFlows.NONE, CoachVideoCache.NONE, letGoWithoutVideo);
    }

    CoachSessionSnapshot session() {
        return DirectVideoCoachBranchTest.looped("버릇: 말끝", List.of(""), "a", "첫 질문");
    }

    void classifiedAs(String signals) {
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":" + signals + "}");
    }

    static final String CORRECTION = "[\"answered\",\"correction\"]";
    static final String ANSWERED = "[\"answered\"]";

    @Test void aLetGoReplyIsWrittenWithoutTheVideo() {
        classifiedAs(CORRECTION);
        when(model.reply(isNull(), anyList(), anyString())).thenReturn(REPLY);
        var result = coach(true).turn(session(), "아니야, 렌즈 본 거 아니야", UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo(REPLY);
        verify(model).reply(isNull(), anyList(), anyString());
        verify(model, never()).reply(eq(file), anyList(), anyString());
        verify(model, never()).upload(any(), anyString());
        verify(model, never()).ready(any());
        verify(storage, never()).downloadToPath(anyString(), any());
        assertThat(telemetry.calls().getLast().metadata()).containsEntry("video_omitted", "true");
    }

    @Test void aStreamedLetGoReplyIsWrittenWithoutTheVideoAndStillStreams() {
        classifiedAs(CORRECTION);
        when(model.replyStream(isNull(), anyList(), anyString(), any())).thenAnswer(call -> {
            java.util.function.Consumer<String> onText = call.getArgument(3);
            onText.accept(REPLY);
            return REPLY;
        });
        var streamed = new ArrayList<String>();
        var result = coach(true).turn(session(), "아니야, 렌즈 본 거 아니야", UUID.randomUUID(), new CoachStream() {
            @Override public void begin() { }
            @Override public void delta(String text) { streamed.add(text); }
        });
        assertThat(result.reply().message()).isEqualTo(REPLY);
        assertThat(String.join("", streamed)).isEqualTo(REPLY);
        verify(model, never()).replyStream(eq(file), anyList(), anyString(), any());
        verify(model, never()).upload(any(), anyString());
        assertThat(telemetry.calls().getLast().metadata()).containsEntry("video_omitted", "true");
    }

    @Test void theEmptyRetryOfALetGoReplyAlsoGoesWithoutTheVideo() {
        classifiedAs(CORRECTION);
        when(model.reply(isNull(), anyList(), anyString())).thenReturn("  ", REPLY);
        var result = coach(true).turn(session(), "아니야, 렌즈 본 거 아니야", UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo(REPLY);
        verify(model, never()).reply(eq(file), anyList(), anyString());
        verify(model, never()).upload(any(), anyString());
    }

    @Test void otherRepliesStillCarryTheVideo() {
        classifiedAs(ANSWERED);
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("그때 누구를 봤어요?");
        coach(true).turn(session(), "붙잡고 싶었어", UUID.randomUUID());
        verify(model).reply(eq(file), anyList(), anyString());
        verify(model, never()).reply(isNull(), anyList(), anyString());
        assertThat(telemetry.calls().getLast().metadata()).containsEntry("video_omitted", "false");
    }

    @Test void otherStreamedRepliesStillCarryTheVideo() {
        classifiedAs(ANSWERED);
        when(model.replyStream(eq(file), anyList(), anyString(), any())).thenAnswer(call -> {
            java.util.function.Consumer<String> onText = call.getArgument(3);
            onText.accept("그때 누구를 봤어요?");
            return "그때 누구를 봤어요?";
        });
        coach(true).turn(session(), "붙잡고 싶었어", UUID.randomUUID(), new CoachStream() {
            @Override public void begin() { }
            @Override public void delta(String text) { }
        });
        verify(model).replyStream(eq(file), anyList(), anyString(), any());
        verify(model, never()).replyStream(isNull(), anyList(), anyString(), any());
    }

    @Test void withTheSwitchOffALetGoReplyCarriesTheVideoAsBefore() {
        classifiedAs(CORRECTION);
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(REPLY);
        var result = coach(false).turn(session(), "아니야, 렌즈 본 거 아니야", UUID.randomUUID());
        assertThat(result.reply().message()).isEqualTo(REPLY);
        verify(model).reply(eq(file), anyList(), anyString());
        verify(model, never()).reply(isNull(), anyList(), anyString());
        assertThat(telemetry.calls().getLast().metadata()).containsEntry("video_omitted", "false");
    }
}
