package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import com.acttub.actingapi.integration.llm.StructuredJson;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;

/** 한 대화 안에서 올린 영상을 다시 쓴다(SOMA-735). */
class CoachVideoCacheTest {
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final CoachVideoSource videos = mock(CoachVideoSource.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final TextGenerator oldGenerator = mock(TextGenerator.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    final MutableClock clock = new MutableClock(Instant.parse("2026-10-16T07:00:00Z"));
    final DirectVideoModel.Video file = new DirectVideoModel.Video("files/test", "gemini://test", "video/mp4");
    final DirectVideoModel.Video other = new DirectVideoModel.Video("files/other", "gemini://other", "video/mp4");
    final List<Path> temporary = new ArrayList<>();

    CoachVideoCacheTest() {
        when(videos.find(any(), any())).thenReturn(new CoachVideoSource.Video("owned/video.mp4", "video/mp4", "etag"));
        when(storage.downloadToPath(eq("owned/video.mp4"), any())).thenAnswer(call -> {
            Path path = call.getArgument(1);
            temporary.add(path);
            Files.writeString(path, "original video bytes");
            return new StoredObjectMetadata(20, "video/mp4", "\"etag\"");
        });
        when(model.upload(any(), eq("video/mp4"))).thenReturn(file);
        when(model.ready(file)).thenReturn(true);
        when(model.classify(anyList(), anyString(), anyList())).thenReturn("{\"signals\":[\"intention\"]}");
        when(model.reply(eq(file), anyList(), anyString())).thenReturn("말끝을 가볍게 던진 선택이 보여요. 장난스럽게 겁주려는 건가요?");
    }

    CoachSessionSnapshot session() {
        return new CoachSessionSnapshot(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(),
                StructuredJson.MAPPER.createObjectNode(), "", "", "", 8000, "그 외", "그 외", null, "open", "", List.of(),
                PriorContext.EMPTY, "legacy", 0, null, null).withCoachingState("three_layers_v1", 0, null, "open", "");
    }

    CoachEngine engine(CoachVideoCache cache) {
        var direct = new DirectVideoCoach(model, videos, storage, failures, telemetry, false, CoachPersonas.NONE,
                null, 0, CoachFlows.NONE, cache);
        return new CoachEngine(oldGenerator, failures, telemetry, true, Optional.of(direct));
    }

    CoachEngine loopEngine(CoachVideoCache cache) {
        var direct = new DirectVideoCoach(model, videos, storage, failures, telemetry, true, CoachPersonas.NONE,
                null, 0, CoachFlows.NONE, cache);
        return new CoachEngine(oldGenerator, failures, telemetry, true, Optional.of(direct));
    }

    CoachVideoCache scoped() {
        return new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures, "prod", Duration.ofMinutes(60));
    }

    @Test void secondReplyReusesTheVideoUploadedForTheFirstReply() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var engine = engine(cache);
        var first = engine.start(session(), UUID.randomUUID());
        var second = engine.reply(first.session(), "장난스럽게 겁주려는 거야", UUID.randomUUID());
        assertThat(second.session().turns()).hasSize(3);
        // 내려받기·올리기는 첫 답에서 한 번뿐이고, 대화가 열려 있는 동안은 지우지 않는다.
        verify(storage, times(1)).downloadToPath(any(), any());
        verify(model, times(1)).upload(any(), eq("video/mp4"));
        verify(model, never()).delete(any());
        verify(model, times(2)).reply(eq(file), anyList(), anyString());
        assertThat(cache.size()).isEqualTo(1);
        assertThat(telemetry.calls()).last().satisfies(call ->
                assertThat(call.metadata()).containsEntry("video_reused", "true"));
        assertThat(temporary).allSatisfy(path -> assertThat(path).doesNotExist());
        cache.close();
        verify(model).delete(file);
        assertThat(cache.size()).isZero();
    }

    @Test void disabledCacheKeepsUploadingAndDeletingEveryReply() {
        var engine = engine(CoachVideoCache.NONE);
        var first = engine.start(session(), UUID.randomUUID());
        engine.reply(first.session(), "장난스럽게 겁주려는 거야", UUID.randomUUID());
        verify(model, times(2)).upload(any(), eq("video/mp4"));
        verify(model, times(2)).delete(file);
    }

    @Test void failedReplyDeletesTheRememberedVideoAndTheNextReplyUploadsAgain() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var engine = engine(cache);
        var first = engine.start(session(), UUID.randomUUID());
        when(model.reply(eq(file), anyList(), anyString())).thenThrow(new IllegalStateException("provider down"));
        assertThatThrownBy(() -> engine.reply(first.session(), "장난스럽게 겁주려는 거야", UUID.randomUUID()))
                .isInstanceOf(CoachReplyUnavailable.class);
        verify(model, times(1)).delete(file);
        assertThat(cache.size()).isZero();
    }

    @Test void expiredVideoFromTheGeminiSideIsUploadedAgain() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var engine = engine(cache);
        var first = engine.start(session(), UUID.randomUUID());
        // 기억은 남았지만 Gemini 쪽에서 사라졌다 — 첫 확인은 실패, 새로 올린 영상은 준비됨.
        when(model.ready(file)).thenThrow(new IllegalStateException("404")).thenReturn(true);
        engine.reply(first.session(), "장난스럽게 겁주려는 거야", UUID.randomUUID());
        verify(model, times(2)).upload(any(), eq("video/mp4"));
        assertThat(cache.size()).isEqualTo(1);
    }

    @Test void idleVideoIsDeletedAndChangedOriginalIsNotReused() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        UUID practice = UUID.randomUUID();
        var key = new CoachVideoCache.Key(practice, "owned/video.mp4", "etag");
        cache.keep(key, file);
        assertThat(cache.take(key)).isEqualTo(file);
        // 원본이 바뀌면 옛 영상은 지우고 다시 쓰지 않는다.
        assertThat(cache.take(new CoachVideoCache.Key(practice, "owned/video.mp4", "etag-2"))).isNull();
        verify(model).delete(file);
        assertThat(cache.size()).isZero();

        cache.keep(key, other);
        clock.advance(Duration.ofMinutes(19));
        assertThat(cache.take(key)).isEqualTo(other);
        clock.advance(Duration.ofMinutes(19));
        cache.sweep();
        // 마지막으로 쓴 뒤 20분이 안 지났다.
        assertThat(cache.size()).isEqualTo(1);
        clock.advance(Duration.ofMinutes(2));
        cache.sweep();
        assertThat(cache.size()).isZero();
        verify(model).delete(other);
        cache.close();
    }

    @Test void deleteFailureIsReportedNotThrown() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        UUID practice = UUID.randomUUID();
        cache.keep(new CoachVideoCache.Key(practice, "k", "e"), file);
        doThrow(new IllegalStateException("delete failed")).when(model).delete(file);
        assertThat(cache.forget(practice)).isEqualTo(file);
        assertThat(failures.contexts()).contains("CoachVideoCache.delete");
        cache.close();
    }

    // --- SOMA-780: 미리 준비 ---

    @Test void firstQuestionUsesTheVideoTheAnalysisStepAlreadyPrepared() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var session = session();
        // 분석 작업 쪽 etag 는 따옴표가 붙어 있어도 같은 원본이다.
        var key = new CoachVideoCache.Key(session.practiceSessionId(), "owned/video.mp4", "\"etag\"");
        var inspection = new DirectVideoModel.InputInspection(true, null, true);
        assertThat(cache.warm(key, () -> new CoachVideoCache.Prepared(inspection, file))).isTrue();
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(DirectVideoCoachTest.OPENING);

        var first = loopEngine(cache).start(session, UUID.randomUUID());

        assertThat(first.reply().message()).isEqualTo(DirectVideoCoachTest.OPENING_SHOWN);
        // 첫 질문은 내려받기·소리 검사·올리기·처리 대기를 다시 하지 않았다.
        verify(storage, never()).downloadToPath(any(), any());
        verify(model, never()).inspect(any());
        verify(model, never()).upload(any(), anyString());
        verify(model, never()).upload(any(), anyString(), any());
        verify(model, never()).ready(any());
        verify(model, never()).delete(any());
        // 다음 답에서 다시 쓰도록 기억해 둔다.
        assertThat(cache.size()).isEqualTo(1);
        assertThat(cache.warmingSize()).isZero();
        cache.close();
    }

    @Test void firstQuestionWaitsForAPreparationThatIsStillRunning() throws Exception {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var session = session();
        var key = new CoachVideoCache.Key(session.practiceSessionId(), "owned/video.mp4", "etag");
        var release = new java.util.concurrent.CountDownLatch(1);
        cache.warm(key, () -> {
            try {
                release.await();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            return new CoachVideoCache.Prepared(new DirectVideoModel.InputInspection(true, null, true), file);
        });
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(DirectVideoCoachTest.OPENING);
        var started = java.util.concurrent.CompletableFuture.supplyAsync(() -> loopEngine(cache).start(session, UUID.randomUUID()));
        Thread.sleep(300);
        assertThat(started).as("미리 준비가 끝나길 기다린다").isNotDone();
        release.countDown();
        assertThat(started.get(5, java.util.concurrent.TimeUnit.SECONDS).reply().message())
                .isEqualTo(DirectVideoCoachTest.OPENING_SHOWN);
        verify(storage, never()).downloadToPath(any(), any());
        verify(model, never()).upload(any(), anyString(), any());
        cache.close();
    }

    @Test void silentAudioFoundWhilePreparingClosesWithoutDownloadingAgain() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var session = session();
        var key = new CoachVideoCache.Key(session.practiceSessionId(), "owned/video.mp4", "etag");
        cache.warm(key, () -> new CoachVideoCache.Prepared(new DirectVideoModel.InputInspection(true, null, false), null));

        var result = loopEngine(cache).start(session, UUID.randomUUID());

        assertThat(result.reply().message()).isEqualTo("영상의 소리가 녹음되지 않았어요.\n소리가 들리는 영상으로 다시 올려 주세요.");
        assertThat(result.session().coachingState().path("practice_loop").path("input_issue").asText()).isEqualTo("silent_audio");
        verify(storage, never()).downloadToPath(any(), any());
        verify(model, never()).inspect(any());
        verify(model, never()).upload(any(), anyString(), any());
        verify(model, never()).reply(any(), anyList(), anyString());
        cache.close();
    }

    @Test void aFailedPreparationFallsBackToUploadingOnTheFirstQuestion() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var session = session();
        cache.warm(new CoachVideoCache.Key(session.practiceSessionId(), "owned/video.mp4", "etag"),
                () -> { throw new IllegalStateException("gemini down"); });
        var inspection = new DirectVideoModel.InputInspection(true, null, true);
        when(model.inspect(any())).thenReturn(inspection);
        when(model.upload(any(), eq("video/mp4"), eq(inspection))).thenReturn(file);
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(DirectVideoCoachTest.OPENING);

        var first = loopEngine(cache).start(session, UUID.randomUUID());

        assertThat(first.reply().message()).isEqualTo(DirectVideoCoachTest.OPENING_SHOWN);
        verify(storage, times(1)).downloadToPath(any(), any());
        verify(model, times(1)).upload(any(), eq("video/mp4"), eq(inspection));
        assertThat(failures.contexts()).contains("CoachVideoCache.warm");
        cache.close();
    }

    @Test void aPreparationForAnotherOriginalIsNotUsedAndItsVideoIsDeleted() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        UUID practice = UUID.randomUUID();
        cache.warm(new CoachVideoCache.Key(practice, "owned/video.mp4", "old"), () -> new CoachVideoCache.Prepared(null, file));
        assertThat(cache.claimWarm(new CoachVideoCache.Key(practice, "owned/video.mp4", "new"), Duration.ofSeconds(1))).isNull();
        verify(model, timeout(2000)).delete(file);
        assertThat(cache.warmingSize()).isZero();
        cache.close();
    }

    @Test void aPreparedVideoNobodyAskedForIsDeletedAfterIdle() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        cache.warm(new CoachVideoCache.Key(UUID.randomUUID(), "k", "e"), () -> new CoachVideoCache.Prepared(null, file));
        clock.advance(Duration.ofMinutes(19));
        cache.sweep();
        assertThat(cache.warmingSize()).isEqualTo(1);
        clock.advance(Duration.ofMinutes(2));
        cache.sweep();
        assertThat(cache.warmingSize()).isZero();
        verify(model, timeout(2000)).delete(file);
        cache.close();
    }

    @Test void disabledCacheNeverPrepares() {
        assertThat(CoachVideoCache.NONE.warm(new CoachVideoCache.Key(UUID.randomUUID(), "k", "e"),
                () -> new CoachVideoCache.Prepared(null, file))).isFalse();
        assertThat(CoachVideoCache.NONE.claimWarm(new CoachVideoCache.Key(UUID.randomUUID(), "k", "e"), Duration.ofSeconds(1))).isNull();
    }

    // --- SOMA-780: 배포해도 영상 유지 ---

    @Test void labelsCarryTheEnvironmentAndPracticeButNotTheStorageKey() {
        var cache = scoped();
        UUID practice = UUID.randomUUID();
        String label = cache.label(new CoachVideoCache.Key(practice, "videos/user/secret.mp4", "\"etag\""));
        assertThat(label).startsWith("acttub-coach:prod:" + practice + ":").doesNotContain("videos/", "secret");
        assertThat(cache.label(new CoachVideoCache.Key(practice, "videos/user/secret.mp4", "etag"))).isEqualTo(label);
        assertThat(new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures)
                .label(new CoachVideoCache.Key(practice, "k", "e"))).as("이름표를 쓰지 않는 옛 방식").isNull();
        cache.close();
    }

    @Test void aConversationContinuesAfterADeployWithoutUploadingAgain() {
        var before = scoped();
        var labels = org.mockito.ArgumentCaptor.forClass(String.class);
        when(model.upload(any(), eq("video/mp4"), any(), labels.capture())).thenReturn(file);
        var first = engine(before).start(session(), UUID.randomUUID());
        before.close();
        // 서버가 꺼져도 지우지 않는다 — 새 서버가 이어 쓴다.
        verify(model, never()).delete(any());

        var after = scoped();
        String label = labels.getValue();
        // 목록은 배포 환경 접두어로 한 번 받아 정확한 이름표만 고른다(올리기 끝 준비의 이름표도 함께 찾는다).
        when(model.labeled("acttub-coach:prod:")).thenReturn(List.of(new DirectVideoModel.Labeled(file, label, clock.instant())));
        var second = engine(after).reply(first.session(), "장난스럽게 겁주려는 거야", UUID.randomUUID());

        assertThat(second.session().turns()).hasSize(3);
        verify(storage, times(1)).downloadToPath(any(), any());
        verify(model, times(1)).upload(any(), eq("video/mp4"), any(), anyString());
        verify(model, never()).upload(any(), eq("video/mp4"));
        assertThat(after.size()).isEqualTo(1);
        // 그다음부터는 메모리에서 찾는다.
        engine(after).reply(second.session(), "응 맞아", UUID.randomUUID());
        verify(model, times(1)).labeled("acttub-coach:prod:");
        after.close();
    }

    @Test void closingAConversationStartedOnAnotherServerDeletesItsLabeledVideo() {
        var cache = scoped();
        UUID practice = UUID.randomUUID();
        String prefix = "acttub-coach:prod:" + practice + ":";
        when(model.labeled(prefix)).thenReturn(List.of(new DirectVideoModel.Labeled(file, prefix + "abc", clock.instant())));
        assertThat(cache.forget(practice)).isNull();
        verify(model, timeout(2000)).delete(file);
        cache.close();
    }

    @Test void orphanSweepDeletesOnlyOldLabeledFilesNobodyHolds() {
        var cache = scoped();
        UUID held = UUID.randomUUID();
        cache.keep(new CoachVideoCache.Key(held, "k", "e"), file);
        var old = new DirectVideoModel.Video("files/old", "gemini://old", "video/mp4", true);
        var fresh = new DirectVideoModel.Video("files/fresh", "gemini://fresh", "video/mp4", true);
        when(model.labeled("acttub-coach:prod:")).thenReturn(List.of(
                new DirectVideoModel.Labeled(file, "acttub-coach:prod:" + held + ":x", clock.instant().minus(Duration.ofHours(2))),
                new DirectVideoModel.Labeled(old, "acttub-coach:prod:" + UUID.randomUUID() + ":y", clock.instant().minus(Duration.ofMinutes(61))),
                new DirectVideoModel.Labeled(fresh, "acttub-coach:prod:" + UUID.randomUUID() + ":z", clock.instant().minus(Duration.ofMinutes(10)))));
        cache.sweepOrphans();
        verify(model).delete(old);
        verify(model, never()).delete(file);
        verify(model, never()).delete(fresh);
        cache.close();
    }

    @Test void aFailedLookupIsReportedAndTheReplyUploadsAgain() {
        var cache = scoped();
        when(model.labeled(anyString())).thenThrow(new IllegalStateException("list failed"));
        assertThat(cache.take(new CoachVideoCache.Key(UUID.randomUUID(), "k", "e"))).isNull();
        assertThat(failures.contexts()).contains("CoachVideoCache.remote");
        cache.close();
    }

    // --- SOMA-780: 가장자리 ---

    @Test void aPreparationThatTakesTooLongIsDroppedAndDeletedWhenItFinishes() throws Exception {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var key = new CoachVideoCache.Key(UUID.randomUUID(), "k", "e");
        var release = new java.util.concurrent.CountDownLatch(1);
        cache.warm(key, () -> {
            try {
                release.await();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            return new CoachVideoCache.Prepared(null, file);
        });
        assertThat(cache.claimWarm(key, Duration.ofMillis(100))).isNull();
        verify(model, never()).delete(any());
        release.countDown();
        verify(model, timeout(2000)).delete(file);
        assertThat(cache.claimWarm(key, Duration.ofSeconds(1))).as("한 번 가져간 준비는 다시 없다").isNull();
        cache.close();
    }

    @Test void closingOrRestartingAPreparationDiscardsTheEarlierOne() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        UUID practice = UUID.randomUUID();
        var key = new CoachVideoCache.Key(practice, "k", "e");
        cache.warm(key, () -> new CoachVideoCache.Prepared(null, file));
        cache.warm(key, () -> new CoachVideoCache.Prepared(null, other));
        verify(model, timeout(2000)).delete(file);
        assertThat(cache.forget(practice)).isNull();
        verify(model, timeout(2000)).delete(other);
        assertThat(cache.warmingSize()).isZero();
        cache.close();
    }

    @Test void serverShutdownWithoutLabelsDeletesUnclaimedPreparations() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        cache.warm(new CoachVideoCache.Key(UUID.randomUUID(), "k", null), () -> new CoachVideoCache.Prepared(null, file));
        cache.close();
        verify(model, timeout(2000)).delete(file);
        assertThat(new CoachVideoCache.Key(UUID.randomUUID(), "k", null).etag()).isNull();
    }

    @Test void withoutLabelsAMissNeverAsksGemini() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        assertThat(cache.take(new CoachVideoCache.Key(UUID.randomUUID(), "k", "e"))).isNull();
        assertThat(cache.claimWarm(new CoachVideoCache.Key(UUID.randomUUID(), "k", "e"), Duration.ofSeconds(1))).isNull();
        cache.sweepOrphans();
        verify(model, never()).labeled(anyString());
        cache.close();
    }

    @Test void remoteLookupTakesOnlyTheExactLabelAndTheNewestFile() {
        var cache = scoped();
        var key = new CoachVideoCache.Key(UUID.randomUUID(), "k", "e");
        String label = cache.label(key);
        when(model.labeled("acttub-coach:prod:")).thenReturn(List.of(new DirectVideoModel.Labeled(other, label + "x", clock.instant())));
        assertThat(cache.take(key)).as("이름표가 정확히 같아야 한다").isNull();
        var older = new DirectVideoModel.Video("files/older", "gemini://older", "video/mp4", true);
        when(model.labeled("acttub-coach:prod:")).thenReturn(List.of(
                new DirectVideoModel.Labeled(older, label, clock.instant().minus(Duration.ofMinutes(5))),
                new DirectVideoModel.Labeled(file, label, clock.instant()),
                new DirectVideoModel.Labeled(other, label, null)));
        assertThat(cache.take(key)).isEqualTo(file);
        cache.close();
    }

    @Test void orphanSweepKeepsAFinishedPreparationNobodyClaimedYet() throws Exception {
        var cache = scoped();
        UUID practice = UUID.randomUUID();
        var done = new java.util.concurrent.CountDownLatch(1);
        cache.warm(new CoachVideoCache.Key(practice, "k", "e"), () -> {
            done.countDown();
            return new CoachVideoCache.Prepared(null, file);
        });
        assertThat(done.await(2, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        Thread.sleep(100);
        when(model.labeled("acttub-coach:prod:")).thenReturn(List.of(
                new DirectVideoModel.Labeled(file, "acttub-coach:prod:" + practice + ":x", clock.instant().minus(Duration.ofHours(2)))));
        cache.sweepOrphans();
        verify(model, never()).delete(file);
        cache.close();
    }

    @Test void remoteListingFailuresAreReportedNotThrown() {
        var cache = scoped();
        when(model.labeled(anyString())).thenThrow(new IllegalStateException("list failed"));
        cache.sweepOrphans();
        assertThat(failures.contexts()).contains("CoachVideoCache.deleteRemote");
        cache.close();
    }

    // --- 10/21: 올리기가 끝난 순간 시작한 준비 ---

    @Test void firstQuestionTakesThePreparationStartedWhenTheUploadFinished() {
        var cache = scoped();
        var session = session();
        var inspection = new DirectVideoModel.InputInspection(true, null, true);
        assertThat(cache.warmSource("owned/video.mp4", "\"etag\"", () -> new CoachVideoCache.Prepared(inspection, file))).isTrue();
        assertThat(cache.warmSource("owned/video.mp4", "etag", () -> new CoachVideoCache.Prepared(inspection, other)))
                .as("같은 원본은 한 번만 준비한다").isFalse();
        when(model.reply(eq(file), anyList(), anyString())).thenReturn(DirectVideoCoachTest.OPENING);

        var first = loopEngine(cache).start(session, UUID.randomUUID());

        assertThat(first.reply().message()).isEqualTo(DirectVideoCoachTest.OPENING_SHOWN);
        verify(storage, never()).downloadToPath(any(), any());
        verify(model, never()).upload(any(), anyString(), any(), anyString());
        assertThat(cache.sourceWarmingSize()).isZero();
        assertThat(cache.size()).as("대화가 이어지면 회차로 기억한다").isEqualTo(1);
        cache.close();
    }

    @Test void anotherOriginalsUploadPreparationIsNotTaken() {
        var cache = scoped();
        cache.warmSource("owned/other.mp4", "etag", () -> new CoachVideoCache.Prepared(null, file));
        assertThat(cache.claimWarm(new CoachVideoCache.Key(UUID.randomUUID(), "owned/video.mp4", "etag"), Duration.ofSeconds(1))).isNull();
        assertThat(cache.sourceWarmingSize()).isEqualTo(1);
        cache.close();
    }

    @Test void anUnclaimedUploadPreparationIsDeletedAfterTenMinutes() throws Exception {
        var cache = scoped();
        var done = new java.util.concurrent.CountDownLatch(1);
        cache.warmSource("owned/video.mp4", "etag", () -> {
            done.countDown();
            return new CoachVideoCache.Prepared(null, file);
        });
        assertThat(done.await(2, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        Thread.sleep(100);
        clock.advance(Duration.ofMinutes(9));
        cache.sweep();
        assertThat(cache.sourceWarmingSize()).isEqualTo(1);
        verify(model, never()).delete(any());
        clock.advance(Duration.ofMinutes(2));
        cache.sweep();
        assertThat(cache.sourceWarmingSize()).isZero();
        verify(model).delete(file);
        cache.close();
    }

    @Test void aFailedUploadPreparationLetsTheAnalysisJobPrepareAgain() throws Exception {
        var cache = scoped();
        var done = new java.util.concurrent.CountDownLatch(1);
        cache.warmSource("owned/video.mp4", "etag", () -> {
            done.countDown();
            throw new IllegalStateException("upload failed");
        });
        assertThat(done.await(2, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        Thread.sleep(100);
        assertThat(cache.warmingSource(new CoachVideoCache.Key(UUID.randomUUID(), "owned/video.mp4", "etag"))).isFalse();
        assertThat(cache.sourceWarmingSize()).isZero();
        cache.close();
    }

    @Test void theUploadLabelHasNoPracticeAndALaterReplyFindsIt() {
        var cache = scoped();
        String upload = cache.sourceLabel("k", "\"e\"");
        assertThat(upload).startsWith("acttub-coach:prod:upload:").isEqualTo(cache.sourceLabel("k", "e"));
        assertThat(new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures).sourceLabel("k", "e")).isNull();
        when(model.labeled("acttub-coach:prod:")).thenReturn(List.of(new DirectVideoModel.Labeled(file, upload, clock.instant())));
        assertThat(cache.take(new CoachVideoCache.Key(UUID.randomUUID(), "k", "e"))).isEqualTo(file);
        cache.close();
    }

    @Test void orphanSweepKeepsAnUploadPreparationNobodyClaimedYet() throws Exception {
        var cache = scoped();
        var done = new java.util.concurrent.CountDownLatch(1);
        cache.warmSource("k", "e", () -> {
            done.countDown();
            return new CoachVideoCache.Prepared(null, file);
        });
        assertThat(done.await(2, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        Thread.sleep(100);
        when(model.labeled("acttub-coach:prod:")).thenReturn(List.of(
                new DirectVideoModel.Labeled(file, cache.sourceLabel("k", "e"), clock.instant().minus(Duration.ofHours(2)))));
        cache.sweepOrphans();
        verify(model, never()).delete(file);
        cache.close();
    }

    @Test void serverShutdownWithoutLabelsDeletesUnclaimedUploadPreparations() throws Exception {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var done = new java.util.concurrent.CountDownLatch(1);
        cache.warmSource("k", "e", () -> {
            done.countDown();
            return new CoachVideoCache.Prepared(null, file);
        });
        assertThat(done.await(2, java.util.concurrent.TimeUnit.SECONDS)).isTrue();
        Thread.sleep(100);
        cache.close();
        verify(model).delete(file);
    }

    @Test void nothingIsPreparedWhenTheCacheIsOffOrTheKeyIsBlank() {
        assertThat(CoachVideoCache.NONE.warmSource("k", "e", () -> new CoachVideoCache.Prepared(null, file))).isFalse();
        assertThat(CoachVideoCache.NONE.warmingSource(new CoachVideoCache.Key(UUID.randomUUID(), "k", "e"))).isFalse();
        var cache = scoped();
        assertThat(cache.warmSource(" ", "e", () -> new CoachVideoCache.Prepared(null, file))).isFalse();
        assertThat(cache.warmingSource(new CoachVideoCache.Key(UUID.randomUUID(), null, "e"))).isFalse();
        cache.close();
    }

    // 10/27: 미리 준비가 늦으면 같은 준비를 하나 더 시작해 먼저 끝난 쪽을 쓴다.
    @Test void slowWarmIsRacedByASecondPreparationAndTheLoserIsDeleted() throws Exception {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var key = new CoachVideoCache.Key(UUID.randomUUID(), "owned/video.mp4", "etag");
        var release = new java.util.concurrent.CountDownLatch(1);
        cache.warm(key, () -> {
            try {
                release.await();
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            return new CoachVideoCache.Prepared(null, file);
        });
        var claimed = cache.claimWarm(key, Duration.ofSeconds(5), Duration.ofMillis(100),
                () -> new CoachVideoCache.Prepared(null, other));
        assertThat(claimed.video()).isEqualTo(other);
        // 늦게 끝난 미리 준비의 영상은 끝나는 대로 지운다.
        release.countDown();
        verify(model, timeout(2000)).delete(file);
        verify(model, never()).delete(other);
        cache.close();
    }

    @Test void fastWarmNeverStartsTheSecondPreparation() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var key = new CoachVideoCache.Key(UUID.randomUUID(), "owned/video.mp4", "etag");
        cache.warm(key, () -> new CoachVideoCache.Prepared(null, file));
        var hedged = new java.util.concurrent.atomic.AtomicBoolean();
        var claimed = cache.claimWarm(key, Duration.ofSeconds(5), Duration.ofSeconds(2), () -> {
            hedged.set(true);
            return new CoachVideoCache.Prepared(null, other);
        });
        assertThat(claimed.video()).isEqualTo(file);
        assertThat(hedged).isFalse();
        cache.close();
    }

    @Test void failedSecondPreparationStillWaitsForTheWarm() throws Exception {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var key = new CoachVideoCache.Key(UUID.randomUUID(), "owned/video.mp4", "etag");
        cache.warm(key, () -> {
            try {
                Thread.sleep(400);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            return new CoachVideoCache.Prepared(null, file);
        });
        var claimed = cache.claimWarm(key, Duration.ofSeconds(5), Duration.ofMillis(100), () -> {
            throw new IllegalStateException("upload failed");
        });
        assertThat(claimed.video()).isEqualTo(file);
        verify(model, after(300).never()).delete(any());
        cache.close();
    }

    @Test void bothPreparationsFailingFallsBackToTheDirectPath() {
        var cache = new CoachVideoCache(model, Duration.ofMinutes(20), clock, failures);
        var key = new CoachVideoCache.Key(UUID.randomUUID(), "owned/video.mp4", "etag");
        cache.warm(key, () -> {
            try {
                Thread.sleep(300);
            } catch (InterruptedException interrupted) {
                Thread.currentThread().interrupt();
            }
            throw new IllegalStateException("warm failed");
        });
        assertThat(cache.claimWarm(key, Duration.ofSeconds(5), Duration.ofMillis(100), () -> null)).isNull();
        cache.close();
    }
}
