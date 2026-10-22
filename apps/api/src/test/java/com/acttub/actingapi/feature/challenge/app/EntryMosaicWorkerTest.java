package com.acttub.actingapi.feature.challenge.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.domain.ChallengeRules;
import com.acttub.actingapi.feature.video.app.VideoObjectCleanup;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.junit.jupiter.api.Test;

/** 모자이크 워커의 갈래 — 얼굴 없음은 곧바로 실패, 그 밖의 실패는 상한까지 다시, 성공은 붙이고 늦은 사본을 지운다. */
class EntryMosaicWorkerTest {
    private static final Instant NOW = Instant.parse("2026-10-22T09:00:00Z");
    private final EntryRepository entries = mock(EntryRepository.class);
    private final EntryMosaics mosaics = mock(EntryMosaics.class);
    private final VideoObjectCleanup cleanup = mock(VideoObjectCleanup.class);
    private final FailureReporter failures = mock(FailureReporter.class);
    private final EntryMosaicWorker worker =
            new EntryMosaicWorker(entries, mosaics, cleanup, failures, Clock.fixed(NOW, ZoneOffset.UTC));
    private final UUID entry = UUID.randomUUID();

    private EntryRepository.MosaicJob job(int attempts) {
        var job = new EntryRepository.MosaicJob(entry, UUID.randomUUID(), "videos/u/r.mp4", attempts);
        when(mosaics.available()).thenReturn(true);
        when(entries.claimMosaic(ChallengeRules.MOSAIC_MAX_ATTEMPTS, NOW)).thenReturn(job);
        return job;
    }

    @Test void doesNothingWithoutStorageOrFfmpeg() {
        when(mosaics.available()).thenReturn(false);
        assertThat(worker.runOnce()).isFalse();
        verify(entries, never()).claimMosaic(anyInt(), any());
    }

    @Test void stopsWhenThereIsNoWork() {
        when(mosaics.available()).thenReturn(true);
        assertThat(worker.runOnce()).isFalse();
    }

    @Test void attachesTheRenderedMosaicBesideTheOriginal() {
        var job = job(1);
        String key = "videos/u/r.mosaic-" + entry + ".mp4";
        UUID late = UUID.randomUUID();
        when(mosaics.render("videos/u/r.mp4", key)).thenReturn(true);
        when(entries.attachMosaic(job, key, NOW)).thenReturn(List.of(late));
        assertThat(worker.runOnce()).isTrue();
        verify(cleanup).attemptObjectDelete(List.of(late));
        verify(entries, never()).failMosaic(any(), any());
    }

    @Test void aVideoWithoutAFaceFailsAtOnce() {
        var job = job(1);
        when(mosaics.render(anyString(), anyString())).thenReturn(false);
        assertThat(worker.runOnce()).isTrue();
        verify(entries).failMosaic(job, NOW);
        verify(entries, never()).attachMosaic(any(), anyString(), any());
    }

    @Test void otherFailuresRetryUntilTheLastAttempt() {
        var first = job(1);
        when(mosaics.render(anyString(), anyString())).thenThrow(new IllegalStateException("ffmpeg"));
        assertThat(worker.runOnce()).isTrue();
        verify(failures).report(any(IllegalStateException.class), any(FailureContext.class));
        verify(entries, never()).failMosaic(eq(first), any());

        var last = job(ChallengeRules.MOSAIC_MAX_ATTEMPTS);
        assertThat(worker.runOnce()).isTrue();
        verify(entries).failMosaic(last, NOW);
    }

    @Test void mosaicKeysSitBesideTheOriginalPerEntry() {
        assertThat(ChallengeRules.mosaicKey("videos/u/r.mp4", entry)).isEqualTo("videos/u/r.mosaic-" + entry + ".mp4");
        assertThat(ChallengeRules.mosaicKey("videos/u.d/r", entry)).isEqualTo("videos/u.d/r.mosaic-" + entry + ".mp4");
    }
}
