package com.acttub.actingapi.feature.video.app;

import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.video.app.VideoRepository.CompleteOutcome;
import com.acttub.actingapi.feature.video.app.VideoRepository.Completed;
import com.acttub.actingapi.feature.video.app.VideoRepository.IntentView;
import com.acttub.actingapi.feature.video.app.VideoRepository.RemoveOutcome;
import com.acttub.actingapi.feature.video.app.VideoRepository.Removed;
import com.acttub.actingapi.feature.video.app.VideoViews.VideoView;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.support.MutableClock;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.Test;

/**
 * practice.record·practice.library: 저장소가 마무리·파일 파기 사이의 경합 끝에 낸 결과를 응답으로 옮긴다 — 다른 요청이 먼저
 * 확정했으면 같은 영상, 사라진 예약은 404, 시한이 지난 예약은 422 다.
 */
class VideoServiceOutcomeTest {
    final VideoRepository videos = mock(VideoRepository.class);
    final VideoStorage storage = mock(VideoStorage.class);
    final VideoObjectCleanup cleanup = mock(VideoObjectCleanup.class);
    final MutableClock clock = new MutableClock(Instant.parse("2026-10-20T00:00:00Z"));
    final VideoService service = new VideoService(videos, storage, cleanup, clock);
    final UUID user = UUID.randomUUID();
    final UUID intent = UUID.randomUUID();

    VideoView video(String posterKey, Instant purgedAt) {
        return new VideoView(UUID.randomUUID(), "videos/u/r.mp4", "video/mp4", 100, 9000, false, purgedAt, clock.instant(), 0, 0,
                null, null, posterKey, null);
    }

    void completesWith(CompleteOutcome outcome, VideoView video) {
        when(videos.findIntent(user, intent)).thenReturn(new IntentView("videos/u/r.mp4", clock.instant().plusSeconds(60), null));
        when(storage.head("videos/u/r.mp4")).thenReturn(new VideoStorage.Stored(100, "etag"));
        when(videos.complete(eq(user), eq(intent), any(), anyLong(), any())).thenReturn(new Completed(outcome, video, List.of()));
    }

    void rejects(ThrowingCallable call, int status, String detail) {
        assertThatThrownBy(call).isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(status)).hasMessage(detail);
    }

    @Test void aCompletionRacedByAnotherRequestReturnsTheSameVideoWithoutCreating() {
        VideoView already = video(null, null);
        completesWith(CompleteOutcome.REPLAYED, already);
        when(storage.presignPlayback(eq("videos/u/r.mp4"), anyInt())).thenReturn(null);
        var completion = service.completeIntent(user, false, intent);
        assertThat(completion.created()).isFalse();
        assertThat(completion.video()).isEqualTo(already);
    }

    @Test void anIntentThatVanishedOrExpiredDuringCompletionIsRejected() {
        completesWith(CompleteOutcome.NOT_FOUND, null);
        rejects(() -> service.completeIntent(user, false, intent), 404, "upload_intent_not_found");
        completesWith(CompleteOutcome.EXPIRED, null);
        rejects(() -> service.completeIntent(user, false, intent), 422, "upload_expired");
    }

    @Test void anIntentWhoseVideoWasRemovedIsCompletedAgain() {
        UUID gone = UUID.randomUUID();
        when(videos.findIntent(user, intent)).thenReturn(new IntentView("videos/u/r.mp4", clock.instant().plusSeconds(60), gone));
        when(videos.find(user, gone)).thenReturn(null);
        when(storage.head("videos/u/r.mp4")).thenReturn(new VideoStorage.Stored(100, "etag"));
        VideoView created = video(null, null);
        when(videos.complete(eq(user), eq(intent), any(), anyLong(), any())).thenReturn(new Completed(CompleteOutcome.CREATED, created, List.of()));
        assertThat(service.completeIntent(user, false, intent).created()).isTrue();
    }

    @Test void purgingAFileInUseOrMissingIsRejected() {
        UUID id = UUID.randomUUID();
        when(videos.purgeFile(eq(user), eq(id), any())).thenReturn(new Removed(RemoveOutcome.IN_USE, null, List.of()));
        rejects(() -> service.purgeFile(user, id), 422, "video_in_use");
        when(videos.purgeFile(eq(user), eq(id), any())).thenReturn(new Removed(RemoveOutcome.NOT_FOUND, null, List.of()));
        rejects(() -> service.purgeFile(user, id), 404, "video_not_found");
    }

    @Test void aPosterIsOnlySignedForALiveVideoWhoseStorageAnswers() {
        UUID id = UUID.randomUUID();
        VideoView withPoster = video("videos/u/r.poster.jpg", null);
        when(videos.find(user, id)).thenReturn(withPoster);
        when(storage.presignPlayback(eq("videos/u/r.poster.jpg"), anyInt())).thenReturn(null);
        when(storage.presignPlayback(eq("videos/u/r.mp4"), anyInt())).thenReturn("https://storage.test/r.mp4");
        VideoView shown = service.find(user, id);
        assertThat(shown.posterUrl()).isNull();
        assertThat(shown.playbackUrl()).isEqualTo("https://storage.test/r.mp4");

        VideoView purged = video("videos/u/r.poster.jpg", clock.instant());
        when(videos.find(user, id)).thenReturn(purged);
        assertThat(service.find(user, id)).isEqualTo(purged);
    }

    // --- SOMA-780: 올리기가 끝나면 코칭이 첫 질문용 영상을 미리 준비한다 ---

    @Test void aNewUploadStartsTheCoachPreparationButAReplayDoesNot() {
        VideoUploadWarmup warmup = mock(VideoUploadWarmup.class);
        VideoService warming = new VideoService(videos, storage, cleanup, clock, warmup);
        completesWith(CompleteOutcome.CREATED, video(null, null));
        assertThat(warming.completeIntent(user, false, intent).created()).isTrue();
        verify(warmup).uploaded("videos/u/r.mp4", "etag", "video/mp4");

        completesWith(CompleteOutcome.REPLAYED, video(null, null));
        assertThat(warming.completeIntent(user, false, intent).created()).isFalse();
        verify(warmup, times(1)).uploaded(any(), any(), any());
    }

    /** 얼굴 가리기를 켜고 올린 영상은 원본으로 미리 올리기를 하지 않는다 — 원본이 코치 AI 쪽으로 가지 않는다(practice.start). */
    @Test void aFaceMosaicUploadNeverStartsTheCoachPreparation() {
        VideoUploadWarmup warmup = mock(VideoUploadWarmup.class);
        VideoService warming = new VideoService(videos, storage, cleanup, clock, warmup);
        completesWith(CompleteOutcome.CREATED, video(null, null));
        assertThat(warming.completeIntent(user, false, intent, true).created()).isTrue();
        verify(warmup, never()).uploaded(any(), any(), any());

        assertThat(warming.completeIntent(user, false, intent, false).created()).isTrue();
        verify(warmup).uploaded("videos/u/r.mp4", "etag", "video/mp4");
    }

    @Test void aFailingPreparationDoesNotBreakTheUpload() {
        VideoUploadWarmup warmup = mock(VideoUploadWarmup.class);
        doThrow(new IllegalStateException("gemini down")).when(warmup).uploaded(any(), any(), any());
        completesWith(CompleteOutcome.CREATED, video(null, null));
        assertThat(new VideoService(videos, storage, cleanup, clock, warmup).completeIntent(user, false, intent).created()).isTrue();
        assertThat(new VideoService(videos, storage, cleanup, clock, null).completeIntent(user, false, intent).created()).isTrue();
    }
}
