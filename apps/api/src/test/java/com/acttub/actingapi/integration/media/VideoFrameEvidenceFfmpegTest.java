package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.BufferedReader;
import java.io.StringReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** 실제 ffmpeg 로 완전히 검은 영상과 보이는 영상을 가르고, 중단과 잘못된 측정을 본다. */
class VideoFrameEvidenceFfmpegTest {
    @TempDir
    Path directory;

    private final VideoFrameEvidence evidence = new VideoFrameEvidence();

    @Test
    void blackVideoIsEntirelyBlackAndATestPatternIsNot() throws Exception {
        assertThat(evidence.entirelyBlack(video("black.mp4", "color=c=black:size=160x120:rate=5:duration=1")))
                .isTrue();
        assertThat(evidence.entirelyBlack(video("pattern.mp4", "testsrc=size=160x120:rate=5:duration=1")))
                .isFalse();
    }

    @Test
    void interruptedInspectionFailsAndKeepsTheInterrupt() throws Exception {
        Path pattern = video("interrupted.mp4", "testsrc=size=160x120:rate=5:duration=1");

        Thread.currentThread().interrupt();
        try {
            assertThatThrownBy(() -> evidence.entirelyBlack(pattern))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("video frame inspection failed");
            assertThat(Thread.interrupted()).isTrue();
        } finally {
            Thread.interrupted();
        }
    }

    @Test
    void luminanceOutsideEightBitsIsAnInvalidMeasurement() {
        assertThatThrownBy(() -> VideoFrameEvidence.entirelyBlack(new BufferedReader(new StringReader(
                "frame:0\nlavfi.signalstats.YMAX=256\n"))))
                .hasMessage("invalid frame luminance");
    }

    private Path video(String name, String source) throws Exception {
        assumeTrue(ffmpegAvailable(), "ffmpeg 가 없다");
        Path output = directory.resolve(name);
        int exit = new ProcessBuilder(List.of("ffmpeg", "-y", "-f", "lavfi", "-i", source, "-c:v", "libx264",
                "-pix_fmt", "yuv420p", output.toString())).redirectErrorStream(true)
                .redirectOutput(ProcessBuilder.Redirect.DISCARD).start().waitFor();
        assumeTrue(exit == 0 && Files.size(output) > 0, "ffmpeg 가 시험 영상을 만들지 못했다");
        return output;
    }

    private static boolean ffmpegAvailable() {
        try {
            return new ProcessBuilder("ffmpeg", "-version").redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start().waitFor() == 0;
        } catch (Exception missing) {
            return false;
        }
    }
}
