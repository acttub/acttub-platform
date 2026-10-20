package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import com.acttub.actingapi.feature.analysis.app.AnalysisContext;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

/** 분석 작업이 내려받은 원본으로 첫 질문용 영상을 미리 준비한다(SOMA-780). */
class CoachVideoWarmupTest {
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final MutableClock clock = new MutableClock(Instant.parse("2026-10-20T09:00:00Z"));
    final DirectVideoModel.Video file = new DirectVideoModel.Video("files/warm", "gemini://warm", "video/mp4", true);

    AnalysisContext context(UUID practice) {
        return new AnalysisContext(UUID.randomUUID(), practice, "owned/video.mp4", "video/mp4", "\"etag\"", 8000,
                "", "", "", "그 외", "", "three_layers_v1", UUID.randomUUID());
    }

    Path original() throws Exception {
        Path path = Files.createTempFile("analysis-", ".mp4");
        Files.writeString(path, "original video bytes");
        return path;
    }

    CoachVideoCache.Key key(UUID practice) {
        return new CoachVideoCache.Key(practice, "owned/video.mp4", "etag");
    }

    @Test void uploadsACopyThatOutlivesTheAnalysisFileAndWaitsUntilItIsReady() throws Exception {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures, "prod", Duration.ofMinutes(60));
        var inspection = new DirectVideoModel.InputInspection(true, null, true);
        var inspected = new AtomicReference<String>();
        var uploadedFrom = new AtomicReference<Path>();
        when(model.inspect(any())).thenAnswer(call -> {
            inspected.set(Files.readString(call.getArgument(0)));
            return inspection;
        });
        when(model.upload(any(), eq("video/mp4"), eq(inspection), anyString())).thenAnswer(call -> {
            uploadedFrom.set(call.getArgument(0));
            return file;
        });
        when(model.ready(file)).thenReturn(false, true);
        UUID practice = UUID.randomUUID();
        Path original = original();

        new CoachVideoWarmup(model, cache).warm(context(practice), original);
        // 분석 작업은 곧바로 원본 임시 파일을 지운다.
        Files.delete(original);

        var prepared = cache.claimWarm(key(practice), Duration.ofSeconds(5));
        assertThat(prepared).isNotNull();
        assertThat(prepared.video()).isEqualTo(file);
        assertThat(prepared.inspection()).isEqualTo(inspection);
        assertThat(inspected.get()).isEqualTo("original video bytes");
        assertThat(uploadedFrom.get()).isNotEqualTo(original).doesNotExist();
        verify(model).upload(any(), eq("video/mp4"), eq(inspection), startsWith("acttub-coach:prod:" + practice + ":"));
        verify(model, times(2)).ready(file);
        verify(model, never()).delete(any());
        cache.close();
    }

    @Test void withoutLabelsItUploadsTheSameWayTheFirstQuestionWould() throws Exception {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        when(model.inspect(any())).thenReturn(null);
        when(model.upload(any(), eq("video/mp4"))).thenReturn(file);
        when(model.ready(file)).thenReturn(true);
        UUID practice = UUID.randomUUID();
        new CoachVideoWarmup(model, cache).warm(context(practice), original());
        assertThat(cache.claimWarm(key(practice), Duration.ofSeconds(5)).video()).isEqualTo(file);
        verify(model, never()).upload(any(), anyString(), any(), anyString());
        cache.close();
    }

    @Test void silentOrEmptyVideosAreNotUploaded() throws Exception {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        when(model.inspect(any())).thenReturn(new DirectVideoModel.InputInspection(true, null, false));
        UUID practice = UUID.randomUUID();
        new CoachVideoWarmup(model, cache).warm(context(practice), original());
        var prepared = cache.claimWarm(key(practice), Duration.ofSeconds(5));
        assertThat(prepared.video()).isNull();
        assertThat(prepared.inspection().unusableAudio()).isTrue();
        verify(model, never()).upload(any(), anyString());
        verify(model, never()).upload(any(), anyString(), any());
        verify(model, never()).upload(any(), anyString(), any(), anyString());
        cache.close();
    }

    @Test void aVideoThatFailsProcessingIsDeletedAndTheFirstQuestionUploadsItself() throws Exception {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var inspection = new DirectVideoModel.InputInspection(true, null, true);
        when(model.inspect(any())).thenReturn(inspection);
        when(model.upload(any(), eq("video/mp4"), eq(inspection))).thenReturn(file);
        when(model.ready(file)).thenThrow(new IllegalStateException("video processing failed"));
        UUID practice = UUID.randomUUID();
        new CoachVideoWarmup(model, cache).warm(context(practice), original());
        assertThat(cache.claimWarm(key(practice), Duration.ofSeconds(5))).isNull();
        verify(model).delete(file);
        assertThat(failures.contexts()).contains("CoachVideoCache.warm");
        cache.close();
    }

    @Test void aDisabledCacheTouchesNothing() throws Exception {
        new CoachVideoWarmup(model, CoachVideoCache.NONE).warm(context(UUID.randomUUID()), original());
        verifyNoInteractions(model);
    }
}
