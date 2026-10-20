package com.acttub.actingapi.feature.challenge.adapter.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.video.app.VideoStorage;
import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** challenge.entry: 실제 ffprobe 로 저장된 영상의 길이를 재고, 재생 주소·ffprobe 가 없으면 길이를 잴 수 없다. */
class StorageEntryMediaProbeTest {
    @TempDir Path directory;
    final VideoStorage storage = mock(VideoStorage.class);

    @Test void theRealProbeMeasuresTheStoredVideoAndRejectsGarbage() throws Exception {
        requireFfmpegOrSkip();
        Path clip = directory.resolve("one.mp4");
        Process process = new ProcessBuilder("ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=16x16:d=1",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", clip.toString())
                .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();
        assertThat(process.waitFor(30, TimeUnit.SECONDS) && process.exitValue() == 0).isTrue();
        Path garbage = Files.writeString(directory.resolve("garbage.mp4"), "not a video");
        when(storage.presignPlayback(eq("entries/one.mp4"), anyInt())).thenReturn(clip.toString());
        when(storage.presignPlayback(eq("entries/garbage.mp4"), anyInt())).thenReturn(garbage.toString());

        StorageEntryMedia media = new StorageEntryMedia(storage);
        assertThat(media.durationMs("entries/one.mp4")).isEqualTo(1000);
        assertThatThrownBy(() -> media.durationMs("entries/garbage.mp4"))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.status()).isEqualTo(422))
                .hasMessage("video_not_ready");
    }

    @Test void aZeroDurationIsNotReady() {
        when(storage.presignPlayback(eq("k"), anyInt())).thenReturn("https://storage.test/k");
        var media = new StorageEntryMedia(storage, command -> new StorageEntryMedia.Probe.Result(0, "0\n"), "ffprobe");
        assertThatThrownBy(() -> media.durationMs("k")).hasMessage("video_not_ready");
    }

    @Test void withoutAPlaybackUrlOrProbeTheDurationIsUnavailable() {
        var noUrl = new StorageEntryMedia(storage, command -> { throw new AssertionError("no probe"); }, "ffprobe");
        assertThatThrownBy(() -> noUrl.durationMs("k")).isInstanceOf(IllegalStateException.class)
                .hasMessage("video duration probe is unavailable");
        when(storage.presignPlayback(eq("k"), anyInt())).thenReturn("https://storage.test/k");
        var noProbe = new StorageEntryMedia(storage, command -> { throw new AssertionError("no probe"); }, null);
        assertThatThrownBy(() -> noProbe.durationMs("k")).hasMessage("video duration probe is unavailable");
    }

    @Test void playbackUsesATenMinuteUrl() {
        when(storage.presignPlayback("entries/a.mp4", 600)).thenReturn("https://storage.test/a?ttl=600");
        assertThat(new StorageEntryMedia(storage, command -> null, "ffprobe").playbackUrl("entries/a.mp4"))
                .isEqualTo("https://storage.test/a?ttl=600");
    }

    static void requireFfmpegOrSkip() {
        boolean available = runs("ffmpeg", "-version") && runs("ffprobe", "-version");
        if ("true".equals(System.getenv("CI")) && !available) {
            throw new IllegalStateException("ffmpeg/ffprobe missing in CI; the API job must install them");
        }
        Assumptions.assumeTrue(available, "ffmpeg/ffprobe not available locally");
    }

    static boolean runs(String... command) {
        try {
            Process process = new ProcessBuilder(command).redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .redirectError(ProcessBuilder.Redirect.DISCARD).start();
            return process.waitFor(15, TimeUnit.SECONDS) && process.exitValue() == 0;
        } catch (Exception failure) {
            return false;
        }
    }
}
