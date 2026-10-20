package com.acttub.actingapi.feature.analysis.adapter.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.TimeUnit;

import com.acttub.actingapi.feature.analysis.app.UnsupportedMediaError;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** 실제 ffprobe 로 길이를 재고, 영상이 아닌 파일은 지원하지 않는 매체로 거절한다. */
class VideoDurationProbeRealTest {
    @TempDir Path directory;

    @Test void measuresARealClipAndRejectsGarbage() throws Exception {
        boolean available = runs("ffmpeg", "-version") && runs("ffprobe", "-version");
        if ("true".equals(System.getenv("CI")) && !available) {
            throw new IllegalStateException("ffmpeg/ffprobe missing in CI; the API job must install them");
        }
        Assumptions.assumeTrue(available, "ffmpeg/ffprobe not available locally");
        Path clip = directory.resolve("one.mp4");
        Process process = new ProcessBuilder("ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=black:s=16x16:d=1",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", clip.toString())
                .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();
        assertThat(process.waitFor(30, TimeUnit.SECONDS) && process.exitValue() == 0).isTrue();

        assertThat(new VideoDurationProbe().durationMs(clip, null)).isEqualTo(1000);
        assertThat(new VideoDurationProbe().durationMs(clip, 0)).isEqualTo(1000);
        Path garbage = Files.writeString(directory.resolve("garbage.mp4"), "not a video");
        assertThatThrownBy(() -> new VideoDurationProbe().durationMs(garbage, null))
                .isInstanceOf(UnsupportedMediaError.class).hasMessage("video duration is unavailable")
                .cause().hasMessageStartingWith("ffprobe failed: ");
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
