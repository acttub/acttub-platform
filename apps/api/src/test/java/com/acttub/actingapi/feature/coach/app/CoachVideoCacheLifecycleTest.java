package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;

import com.acttub.actingapi.integration.observation.DirectVideoModel;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

/** 올린 영상 기억: 언제 다시 쓰고, 언제 지우는지. */
class CoachVideoCacheLifecycleTest {
    final DirectVideoModel model = mock(DirectVideoModel.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final MutableClock clock = new MutableClock(Instant.parse("2026-10-16T07:00:00Z"));
    final DirectVideoModel.Video first = new DirectVideoModel.Video("files/first", "gemini://first", "video/mp4");
    final DirectVideoModel.Video second = new DirectVideoModel.Video("files/second", "gemini://second", "video/mp4");
    final UUID practice = UUID.randomUUID();
    final CoachVideoCache.Key key = new CoachVideoCache.Key(practice, "owned/video.mp4", "etag-1");

    CoachVideoCache cache() { return new CoachVideoCache(model, Duration.ofMinutes(10), clock, failures); }

    @Test void aDisabledCacheRemembersNothing() {
        for (CoachVideoCache disabled : new CoachVideoCache[]{CoachVideoCache.NONE,
                new CoachVideoCache(model, Duration.ofMinutes(-1), clock, failures),
                new CoachVideoCache(model, null, null, failures)}) {
            assertThat(disabled.enabled()).isFalse();
            disabled.keep(key, first);
            assertThat(disabled.take(key)).isNull();
            assertThat(disabled.size()).isZero();
            disabled.close();
        }
        assertThat(new CoachVideoCache(model, Duration.ofSeconds(30), null, failures).enabled()).isTrue();
    }

    @Test void missingKeysOrVideosAreIgnored() {
        try (CoachVideoCache cache = cache()) {
            assertThat(cache.take(null)).isNull();
            assertThat(cache.take(key)).isNull();
            cache.keep(null, first);
            cache.keep(key, null);
            assertThat(cache.size()).isZero();
            assertThat(cache.forget(null)).isNull();
            assertThat(cache.forget(practice)).isNull();
        }
        verify(model, never()).delete(any());
    }

    @Test void keepingTheSameUploadAgainDoesNotDeleteItButADifferentUploadReplacesIt() {
        try (CoachVideoCache cache = cache()) {
            var again = new DirectVideoModel.Video("files/first", "gemini://first-again", "video/mp4");
            cache.keep(key, first);
            cache.keep(key, again);
            verify(model, never()).delete(any());
            cache.keep(key, second);
            verify(model).delete(again);
            assertThat(cache.take(key)).isEqualTo(second);
            assertThat(cache.forget(practice)).isEqualTo(second);
            verify(model).delete(second);
            assertThat(cache.size()).isZero();
        }
    }

    @Test void aChangedOriginalOrAnIdleUploadIsDeletedInsteadOfReused() {
        try (CoachVideoCache cache = cache()) {
            cache.keep(key, first);
            assertThat(cache.take(new CoachVideoCache.Key(practice, "owned/video.mp4", "etag-2"))).isNull();
            verify(model).delete(first);
            cache.keep(key, second);
            clock.set(clock.instant().plus(Duration.ofMinutes(9)));
            assertThat(cache.take(key)).isEqualTo(second);
            clock.set(clock.instant().plus(Duration.ofMinutes(9)));
            assertThat(cache.take(key)).isEqualTo(second);
            clock.set(clock.instant().plus(Duration.ofMinutes(10)));
            assertThat(cache.take(key)).isNull();
            verify(model).delete(second);
        }
    }

    @Test void theSweeperDeletesOnlyExpiredUploads() {
        try (CoachVideoCache cache = cache()) {
            CoachVideoCache.Key otherKey = new CoachVideoCache.Key(UUID.randomUUID(), "owned/other.mp4", "etag");
            cache.keep(key, first);
            clock.set(clock.instant().plus(Duration.ofMinutes(5)));
            cache.keep(otherKey, second);
            clock.set(clock.instant().plus(Duration.ofMinutes(6)));
            cache.sweep();
            assertThat(cache.size()).isEqualTo(1);
            verify(model).delete(first);
            verify(model, never()).delete(second);
            assertThat(cache.take(otherKey)).isEqualTo(second);
        }
    }

    @Test void closingDeletesEverythingAndDeleteFailuresAreReported() {
        doThrow(new IllegalStateException("gone")).when(model).delete(first);
        CoachVideoCache cache = cache();
        cache.keep(key, first);
        cache.keep(new CoachVideoCache.Key(UUID.randomUUID(), "owned/other.mp4", "etag"), second);
        cache.close();
        assertThat(cache.size()).isZero();
        verify(model).delete(second);
        assertThat(failures.contexts()).containsExactly("CoachVideoCache.delete");

        CoachVideoCache unreported = new CoachVideoCache(model, Duration.ofMinutes(1), clock, null);
        unreported.keep(key, first);
        assertThatCode(unreported::close).doesNotThrowAnyException();
    }

    @Test void uploadsAreTheSameOnlyByName() {
        assertThat(CoachVideoCache.same(first, null)).isFalse();
        assertThat(CoachVideoCache.same(null, first)).isFalse();
        assertThat(CoachVideoCache.same(new DirectVideoModel.Video(null, "u", "video/mp4"), first)).isFalse();
        assertThat(CoachVideoCache.same(first, second)).isFalse();
        assertThat(CoachVideoCache.same(first, new DirectVideoModel.Video("files/first", "other", "video/mp4"))).isTrue();
    }
}
