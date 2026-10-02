package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.BufferedReader;
import java.io.StringReader;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class VideoFrameEvidenceTest {
    @TempDir Path directory;

    @Test void everyMeasuredFrameMustBeExactlyBlack() throws Exception {
        assertThat(black("frame:0\nlavfi.signalstats.YMAX=0\nframe:1\nlavfi.signalstats.YMAX=0\n")).isTrue();
    }

    @Test void oneVisibleFrameBetweenBlackFramesPreservesTheVideo() throws Exception {
        assertThat(black("frame:0\nlavfi.signalstats.YMAX=0\nframe:1\nlavfi.signalstats.YMAX=255\n"
                + "frame:2\nlavfi.signalstats.YMAX=0\n")).isFalse();
    }

    @Test void evenVeryDarkNonBlackEvidenceIsNotRejected() throws Exception {
        assertThat(black("frame:0\nlavfi.signalstats.YMAX=1\n")).isFalse();
    }

    @Test void missingFramesAreNotAssumedToBeBlack() {
        assertThatThrownBy(() -> black("unrelated output\n")).hasMessageContaining("no decoded video frames");
    }

    @Test void incompleteMeasurementsCannotRejectAnInput() {
        assertThatThrownBy(() -> black("frame:0\nlavfi.signalstats.YMAX=0\nframe:1\n"))
                .hasMessageContaining("incomplete frame measurements");
    }

    @Test void malformedMeasurementsCannotRejectAnInput() {
        assertThatThrownBy(() -> black("frame:0\nlavfi.signalstats.YMAX=not-a-number\n"))
                .isInstanceOf(NumberFormatException.class);
        assertThatThrownBy(() -> black("frame:0\nlavfi.signalstats.YMAX=256\n"))
                .hasMessageContaining("invalid frame luminance");
    }

    @Test void realDecoderFindsBlackButPreservesVisibleAndDarkFrames() throws Exception {
        requireFfmpeg();
        Path black = clip("black", "black");
        Path visible = clip("visible", "white");
        Path dark = clip("dark", "0x101010");
        var probe = new VideoFrameEvidence();
        assertThat(probe.entirelyBlack(black)).isTrue();
        assertThat(probe.entirelyBlack(visible)).isFalse();
        assertThat(probe.entirelyBlack(dark)).isFalse();
    }

    @Test void realDecoderNeverAssumesAnUnreadableFileIsEmpty() {
        requireFfmpeg();
        assertThatThrownBy(() -> new VideoFrameEvidence().entirelyBlack(directory.resolve("missing.mp4")))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("video frame inspection failed");
    }

    private static boolean black(String metadata) throws Exception {
        return VideoFrameEvidence.entirelyBlack(new BufferedReader(new StringReader(metadata)));
    }

    private Path clip(String name, String color) throws Exception {
        Path target = directory.resolve(name + ".mp4");
        Process process = new ProcessBuilder(List.of("ffmpeg", "-y", "-f", "lavfi", "-i",
                "color=c=" + color + ":s=16x16:d=0.2", "-c:v", "libx264", "-pix_fmt", "yuv420p",
                target.toString())).redirectOutput(ProcessBuilder.Redirect.DISCARD)
                .redirectError(ProcessBuilder.Redirect.DISCARD).start();
        try {
            assertThat(process.waitFor(20, TimeUnit.SECONDS)).isTrue();
            assertThat(process.exitValue()).isZero();
            return target;
        } finally { if (process.isAlive()) process.destroyForcibly(); }
    }

    private static void requireFfmpeg() {
        boolean available = false;
        Process process = null;
        try {
            process = new ProcessBuilder("ffmpeg", "-version").redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .redirectError(ProcessBuilder.Redirect.DISCARD).start();
            available = process.waitFor(10, TimeUnit.SECONDS) && process.exitValue() == 0;
        } catch (Exception failure) {
            if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
        } finally { if (process != null && process.isAlive()) process.destroyForcibly(); }
        if ("true".equals(System.getenv("CI")) && !available) {
            throw new IllegalStateException("ffmpeg must be available in CI");
        }
        Assumptions.assumeTrue(available, "ffmpeg not available locally");
    }
}
