package com.acttub.actingapi.feature.coach.app;

import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.integration.storage.ObjectStorage;
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

    @Test void missingFactsMeanNoWarmupAndABlankTypeIsTreatedAsMp4() throws Exception {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var warmup = new CoachVideoWarmup(model, cache);
        warmup.warm(new AnalysisContext(UUID.randomUUID(), UUID.randomUUID(), null, "video/mp4", "e", 8000,
                "", "", "", "그 외", "", "three_layers_v1", UUID.randomUUID()), original());
        warmup.warm(null, original());
        warmup.warm(context(UUID.randomUUID()), null);
        verifyNoInteractions(model);

        when(model.inspect(any())).thenReturn(null);
        when(model.upload(any(), eq("video/mp4"))).thenReturn(file);
        when(model.ready(file)).thenReturn(true);
        UUID practice = UUID.randomUUID();
        warmup.warm(new AnalysisContext(UUID.randomUUID(), practice, "owned/video.mp4", " ", "etag", 8000,
                "", "", "", "그 외", "", "three_layers_v1", UUID.randomUUID()), original());
        assertThat(cache.claimWarm(key(practice), Duration.ofSeconds(5)).video()).isEqualTo(file);
        cache.close();
    }

    @Test void anUnreadableAnalysisFileIsAnErrorTheAnalysisIgnores() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        assertThatThrownBy(() -> new CoachVideoWarmup(model, cache).warm(context(UUID.randomUUID()),
                Path.of(System.getProperty("java.io.tmpdir"), "no-such-analysis-" + UUID.randomUUID() + ".mp4")))
                .isInstanceOf(java.io.UncheckedIOException.class);
        assertThat(cache.warmingSize()).isZero();
        cache.close();
    }

    @Test void processingThatNeverFinishesTimesOutAndDeletesTheUpload() throws Exception {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        when(model.inspect(any())).thenReturn(null);
        when(model.upload(any(), eq("video/mp4"))).thenReturn(file);
        when(model.ready(file)).thenReturn(false);
        doThrow(new IllegalStateException("delete failed")).when(model).delete(file);
        UUID practice = UUID.randomUUID();
        new CoachVideoWarmup(model, cache, Duration.ofMillis(600)).warm(context(practice), original());
        assertThat(cache.claimWarm(key(practice), Duration.ofSeconds(5))).isNull();
        verify(model).delete(file);
        assertThat(failures.contexts()).contains("CoachVideoCache.warm");
        cache.close();
    }

    @Test void aFailedInspectionUploadsNothingAndHasNothingToDelete() throws Exception {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        when(model.inspect(any())).thenThrow(new IllegalStateException("audio decoder failed"));
        UUID practice = UUID.randomUUID();
        new CoachVideoWarmup(model, cache, Duration.ofSeconds(5)).warm(context(practice), original());
        assertThat(cache.claimWarm(key(practice), Duration.ofSeconds(5))).isNull();
        verify(model, never()).upload(any(), anyString());
        verify(model, never()).delete(any());
        cache.close();
    }

    // --- 10/21: 올리기가 끝난 순간 시작하는 준비 ---

    ObjectStorage storageWith(String etag) {
        ObjectStorage storage = mock(ObjectStorage.class);
        when(storage.downloadToPath(eq("owned/video.mp4"), any())).thenAnswer(call -> {
            Files.writeString(call.getArgument(1), "uploaded video bytes");
            return new StoredObjectMetadata(20, "video/mp4", etag);
        });
        return storage;
    }

    Path workDir() throws Exception {
        return Files.createTempDirectory(Path.of(System.getProperty("java.io.tmpdir")), "coach-warm-test-");
    }

    @Test void aFinishedUploadIsPreparedAndTheAnalysisJobDoesNotUploadAgain() throws Exception {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures, "prod", Duration.ofMinutes(60));
        Path work = workDir();
        var inspection = new DirectVideoModel.InputInspection(true, null, true);
        var inspected = new AtomicReference<String>();
        when(model.inspect(any())).thenAnswer(call -> {
            inspected.set(Files.readString(call.getArgument(0)));
            return inspection;
        });
        when(model.upload(any(), eq("video/mp4"), eq(inspection), anyString())).thenReturn(file);
        when(model.ready(file)).thenReturn(true);

        new CoachVideoWarmup(model, cache, storageWith("\"etag\""), work).uploaded("owned/video.mp4", "etag", null);
        UUID practice = UUID.randomUUID();
        assertThat(cache.warmingSource(key(practice))).isTrue();
        Path original = original();
        new CoachVideoWarmup(model, cache).warm(context(practice), original);
        Files.delete(original);

        var prepared = cache.claimWarm(key(practice), Duration.ofSeconds(5));
        assertThat(prepared).isNotNull();
        assertThat(prepared.video()).isEqualTo(file);
        assertThat(inspected.get()).isEqualTo("uploaded video bytes");
        verify(model, times(1)).upload(any(), eq("video/mp4"), eq(inspection), startsWith("acttub-coach:prod:upload:"));
        try (var left = Files.list(work)) {
            assertThat(left).as("내려받은 원본은 지운다").isEmpty();
        }
        cache.close();
    }

    @Test void anOriginalThatChangedAfterUploadIsNotPrepared() throws Exception {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures, "prod", Duration.ofMinutes(60));
        Path work = workDir();
        new CoachVideoWarmup(model, cache, storageWith("other"), work).uploaded("owned/video.mp4", "etag", "video/mp4");
        assertThat(cache.claimWarm(key(UUID.randomUUID()), Duration.ofSeconds(5))).isNull();
        verify(model, never()).upload(any(), anyString(), any(), anyString());
        try (var left = Files.list(work)) {
            assertThat(left).isEmpty();
        }
        cache.close();
    }

    @Test void aFailedDownloadLeavesNoFileBehind() throws Exception {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures, "prod", Duration.ofMinutes(60));
        Path work = workDir();
        ObjectStorage storage = mock(ObjectStorage.class);
        when(storage.downloadToPath(any(), any())).thenThrow(new IllegalStateException("storage down"));
        new CoachVideoWarmup(model, cache, storage, work).uploaded("owned/video.mp4", "etag", "video/mp4");
        assertThat(cache.claimWarm(key(UUID.randomUUID()), Duration.ofSeconds(5))).isNull();
        try (var left = Files.list(work)) {
            assertThat(left).isEmpty();
        }
        cache.close();
    }

    @Test void withoutStorageOrWithTheCacheOffAnUploadIsNotPrepared() throws Exception {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures, "prod", Duration.ofMinutes(60));
        new CoachVideoWarmup(model, cache).uploaded("owned/video.mp4", "etag", "video/mp4");
        new CoachVideoWarmup(model, cache, storageWith("etag"), workDir()).uploaded(" ", "etag", "video/mp4");
        assertThat(cache.sourceWarmingSize()).isZero();
        new CoachVideoWarmup(model, CoachVideoCache.NONE, storageWith("etag"), workDir()).uploaded("owned/video.mp4", "etag", "video/mp4");
        new CoachVideoWarmup(null, cache, storageWith("etag"), workDir()).uploaded("owned/video.mp4", "etag", "video/mp4");
        assertThat(cache.sourceWarmingSize()).isZero();
        cache.close();
    }

    @Test
    void warmStartsLayerOneForAssignedPracticeEvenWithoutVideoCache() throws Exception {
        var started = new java.util.concurrent.atomic.AtomicReference<UUID>();
        try (var layer = new CoachLayerOne((v, m, sc, p, u) -> { started.set(p); return "## 1층 관찰"; }, 100, null)) {
            UUID practice = UUID.randomUUID();
            new CoachVideoWarmup(null, CoachVideoCache.NONE).withLayerOne(layer).warm(context(practice), original());
            for (int i = 0; i < 100 && layer.ready(practice).isEmpty(); i++) Thread.sleep(10);
            org.assertj.core.api.Assertions.assertThat(started.get()).isEqualTo(practice);
            org.assertj.core.api.Assertions.assertThat(layer.ready(practice)).isEqualTo("## 1층 관찰");
        }
    }
}
