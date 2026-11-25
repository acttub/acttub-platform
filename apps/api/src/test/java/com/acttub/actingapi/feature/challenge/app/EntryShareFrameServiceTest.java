package com.acttub.actingapi.feature.challenge.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.Executor;
import java.util.concurrent.RejectedExecutionException;
import com.acttub.actingapi.feature.challenge.app.EntryRepository.ShareFrameSource;
import com.acttub.actingapi.feature.challenge.domain.ShareFrames;
import com.acttub.actingapi.feature.video.app.VideoObjectCleanup;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.web.ApiException;
import com.acttub.actingapi.platform.web.ApiValidationException;
import org.junit.jupiter.api.Test;

/** 프레임 영상 요청의 상태(만드는 중·준비·실패)와 캐시, 미리보기 (challenge.entry 공유 프레임, SOMA-1156). */
class EntryShareFrameServiceTest {
    private static final Instant NOW = Instant.parse("2026-11-25T03:00:00Z");
    private static final UUID OWNER = UUID.randomUUID();
    private static final UUID ENTRY = UUID.randomUUID();
    private static final String ORIGINAL = "videos/u/r.mp4";
    private static final String MOSAIC = "videos/u/r.mosaic-e.mp4";

    private final EntryRepository entries = mock(EntryRepository.class);
    private final EntryShareFrames frames = mock(EntryShareFrames.class);
    private final EntryMedia media = mock(EntryMedia.class);
    private final VideoObjectCleanup cleanup = mock(VideoObjectCleanup.class);
    private final FailureReporter failures = mock(FailureReporter.class);
    private final List<Runnable> queued = new ArrayList<>();
    private boolean full;
    private final Executor executor = task -> {
        if (full) throw new RejectedExecutionException("full");
        queued.add(task);
    };
    private final EntryShareFrameService service = new EntryShareFrameService(entries, frames, media, cleanup, failures, executor,
            Clock.fixed(NOW, ZoneOffset.UTC));

    @Test void aMadeFrameIsReadyAtOnce() {
        String key = ShareFrames.videoKey(ORIGINAL, ENTRY, ShareFrames.Frame.WHITE, false);
        when(entries.shareFrameSource(OWNER, ENTRY)).thenReturn(source(false, List.of(key)));
        when(media.playbackUrl(key)).thenReturn("https://get/" + key);
        var video = service.video(OWNER, ENTRY, "white");
        assertThat(video.status()).isEqualTo("ready");
        assertThat(video.videoUrl()).isEqualTo("https://get/" + key);
        assertThat(queued).isEmpty();
        verify(frames, never()).renderVideo(any(), any(), any());
    }

    @Test void theFirstRequestStartsOneRenderAndPollsSeeRenderingUntilItIsAttached() {
        String key = ShareFrames.videoKey(ORIGINAL, ENTRY, ShareFrames.Frame.BLUE, false);
        when(entries.shareFrameSource(OWNER, ENTRY)).thenReturn(source(false, List.of()));
        when(entries.attachShareFrame(any(), eq(key), eq(NOW))).thenReturn(List.of());
        assertThat(service.video(OWNER, ENTRY, "blue").status()).isEqualTo("rendering");
        assertThat(service.video(OWNER, ENTRY, "blue").status()).isEqualTo("rendering");
        assertThat(queued).as("같은 프레임은 한 번만 맡긴다").hasSize(1);
        verify(frames, times(2)).requireConfigured();

        queued.removeFirst().run();
        var card = new ShareFrames.Card(ShareFrames.Frame.BLUE, "괜찮아", 2, "WooYoung", "2026.11.02");
        verify(frames).renderVideo(card, ORIGINAL, key);
        verify(entries).attachShareFrame(source(false, List.of()), key, NOW);
        verify(cleanup).attemptObjectDelete(List.of());

        when(entries.shareFrameSource(OWNER, ENTRY)).thenReturn(source(false, List.of(key)));
        when(media.playbackUrl(key)).thenReturn("https://get/" + key);
        assertThat(service.video(OWNER, ENTRY, "blue").status()).isEqualTo("ready");
    }

    @Test void aFailedRenderIsReportedToldOnceAndThenRetried() {
        String key = ShareFrames.videoKey(ORIGINAL, ENTRY, ShareFrames.Frame.BLACK, false);
        when(entries.shareFrameSource(OWNER, ENTRY)).thenReturn(source(false, List.of()));
        doThrow(new IllegalStateException("ffmpeg")).when(frames).renderVideo(any(), any(), eq(key));
        service.video(OWNER, ENTRY, "black");
        queued.removeFirst().run();
        verify(failures).report(any(IllegalStateException.class), eq(new FailureContext("EntryShareFrameService.render", ENTRY)));
        verify(entries, never()).attachShareFrame(any(), any(), any());

        var failed = service.video(OWNER, ENTRY, "black");
        assertThat(failed.status()).isEqualTo("failed");
        assertThat(failed.videoUrl()).isNull();
        assertThat(service.video(OWNER, ENTRY, "black").status()).isEqualTo("rendering");
        assertThat(queued).as("다음 요청이 다시 맡긴다").hasSize(1);
    }

    @Test void aFullQueueIsTriedAgainOnTheNextRequest() {
        when(entries.shareFrameSource(OWNER, ENTRY)).thenReturn(source(false, List.of()));
        full = true;
        assertThat(service.video(OWNER, ENTRY, "white").status()).isEqualTo("rendering");
        full = false;
        assertThat(service.video(OWNER, ENTRY, "white").status()).isEqualTo("rendering");
        assertThat(queued).hasSize(1);
    }

    @Test void aReadyMosaicIsWhatGetsFramed() {
        String key = ShareFrames.videoKey(ORIGINAL, ENTRY, ShareFrames.Frame.WHITE, true);
        when(entries.shareFrameSource(OWNER, ENTRY)).thenReturn(source(true, List.of()));
        service.video(OWNER, ENTRY, "white");
        queued.removeFirst().run();
        verify(frames).renderVideo(any(), eq(MOSAIC), eq(key));
    }

    @Test void unknownFramesAreRejectedBeforeAnythingIsRead() {
        assertThatThrownBy(() -> service.video(OWNER, ENTRY, "none")).isInstanceOf(ApiValidationException.class);
        assertThatThrownBy(() -> service.video(OWNER, ENTRY, "red")).isInstanceOf(ApiValidationException.class);
        assertThatThrownBy(() -> service.preview(OWNER, ENTRY, "red")).isInstanceOf(ApiValidationException.class);
        verify(entries, never()).shareFrameSource(any(), any());
    }

    @Test void someoneElsesEntryIsNotFound() {
        when(entries.shareFrameSource(OWNER, ENTRY)).thenThrow(new ApiException(404, "entry_not_found"));
        assertThatThrownBy(() -> service.video(OWNER, ENTRY, "white")).isInstanceOf(ApiException.class);
        assertThat(queued).isEmpty();
    }

    @Test void thePreviewIsMadeOnceInTheRequestAndThenServedFromItsKey() {
        String key = ShareFrames.previewKey(ORIGINAL, ENTRY, ShareFrames.Frame.WHITE, false);
        when(entries.shareFrameSource(OWNER, ENTRY)).thenReturn(source(false, List.of()));
        when(entries.attachShareFrame(any(), eq(key), eq(NOW))).thenReturn(List.of());
        when(media.playbackUrl(key)).thenReturn("https://get/" + key);
        assertThat(service.preview(OWNER, ENTRY, "white").imageUrl()).isEqualTo("https://get/" + key);
        verify(frames).renderPreview(any(), eq(ORIGINAL), eq(key));
        verify(entries).attachShareFrame(any(), eq(key), eq(NOW));

        when(entries.shareFrameSource(OWNER, ENTRY)).thenReturn(source(false, List.of(key)));
        service.preview(OWNER, ENTRY, "white");
        verify(frames, times(1)).renderPreview(any(), any(), any());
    }

    @Test void theNonePreviewHasNoFrame() {
        String key = ShareFrames.previewKey(ORIGINAL, ENTRY, null, false);
        when(entries.shareFrameSource(OWNER, ENTRY)).thenReturn(source(false, List.of()));
        service.preview(OWNER, ENTRY, "none");
        verify(frames).renderPreview(new ShareFrames.Card(null, "괜찮아", 2, "WooYoung", "2026.11.02"), ORIGINAL, key);
    }

    @Test void aFaceBlurThatIsNotReadyYetIsNotFramedOnTheOriginal() {
        when(entries.shareFrameSource(OWNER, ENTRY)).thenReturn(pending(List.of()));
        assertThatThrownBy(() -> service.video(OWNER, ENTRY, "white"))
                .isInstanceOf(ApiException.class).hasMessage("mosaic_not_ready");
        assertThatThrownBy(() -> service.preview(OWNER, ENTRY, "blue"))
                .isInstanceOf(ApiException.class).hasMessage("mosaic_not_ready");
        assertThat(queued).isEmpty();
        verify(frames, never()).renderPreview(any(), any(), any());
    }

    @Test void theNonePreviewDoesNotWaitForTheFaceBlur() {
        String key = ShareFrames.previewKey(ORIGINAL, ENTRY, null, false);
        when(entries.shareFrameSource(OWNER, ENTRY)).thenReturn(pending(List.of()));
        service.preview(OWNER, ENTRY, "none");
        verify(frames).renderPreview(any(), eq(ORIGINAL), eq(key));
    }

    @Test void aMemberChallengeHasNoEpisodeOnTheCard() {
        var member = new ShareFrameSource(ENTRY, OWNER, ORIGINAL, ORIGINAL, false, false, "괜찮아", null, "WooYoung",
                Instant.parse("2026-11-01T16:00:00Z"), List.of());
        var card = EntryShareFrameService.card(member, ShareFrames.Frame.WHITE);
        assertThat(card.title()).isEqualTo("대사 챌린지");
        assertThat(card.badge()).isNull();
        assertThat(card.scene()).isNull();
    }

    private static ShareFrameSource source(boolean mosaic, List<String> rendered) {
        return new ShareFrameSource(ENTRY, OWNER, ORIGINAL, mosaic ? MOSAIC : ORIGINAL, mosaic, mosaic, "괜찮아", 2, "WooYoung",
                Instant.parse("2026-11-01T16:00:00Z"), rendered);
    }

    /** 얼굴 가림을 켰고 모자이크본은 아직 없다. */
    private static ShareFrameSource pending(List<String> rendered) {
        return new ShareFrameSource(ENTRY, OWNER, ORIGINAL, ORIGINAL, true, false, "괜찮아", 2, "WooYoung",
                Instant.parse("2026-11-01T16:00:00Z"), rendered);
    }
}
