package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** 틀 씌우기 합성 (challenge.entry 공유 프레임, SOMA-1156). 명령의 모양은 늘 보고, 진짜 합성은 ffmpeg 가 있을 때만 본다. */
class FramedVideoComposerTest {
    @TempDir Path dir;

    @Test void theCommandCoversTheWindowLaysTheFrameOnTopAndKeepsTheSound() {
        var composer = new FramedVideoComposer((command, timeout) -> { }, "ffmpeg");
        List<String> command = composer.command(Path.of("in.mp4"), Path.of("frame.png"), 1080, 1920,
                new int[] {90, 228, 900, 1206}, Path.of("out.mp4"));
        String filter = command.get(command.indexOf("-filter_complex") + 1);
        assertThat(filter).contains("scale=900:1206:force_original_aspect_ratio=increase,crop=900:1206");
        assertThat(filter).contains("overlay=90:228:shortest=1").contains("[base][1:v]overlay=0:0,format=yuv420p");
        assertThat(command).containsSubsequence("-loop", "1", "-i", "frame.png");
        assertThat(command).contains("color=c=black:s=1080x1920:r=30");
        assertThat(command).containsSubsequence("-map", "[out]", "-map", "0:a:0?");
        assertThat(command).containsSubsequence("-c:v", "libx264").containsSubsequence("-pix_fmt", "yuv420p")
                .containsSubsequence("-c:a", "aac").containsSubsequence("-movflags", "+faststart");
        assertThat(command.getLast()).isEqualTo("out.mp4");
    }

    @Test void aStillFromAUrlHasAReadTimeout() {
        var composer = new FramedVideoComposer((command, timeout) -> { }, "ffmpeg");
        assertThat(composer.stillCommand("https://bucket/v.mp4?sig")).containsSubsequence("-rw_timeout", "15000000", "-ss");
        assertThat(composer.stillCommand("/tmp/v.mp4")).doesNotContain("-rw_timeout");
    }

    @Test void withoutFfmpegNothingRuns() {
        var composer = new FramedVideoComposer((command, timeout) -> { }, null);
        assertThat(composer.available()).isFalse();
        assertThatThrownBy(() -> composer.compose(dir.resolve("a"), dir.resolve("b"), 1080, 1920, new int[] {0, 0, 2, 2}))
                .isInstanceOf(IllegalStateException.class);
    }

    @Test void composesATenEightyByNineteenTwentyVideoWithTheOriginalSoundAndLength() throws Exception {
        assumeTrue(ffmpegAvailable(), "ffmpeg 가 없어 건너뛴다");
        Path source = dir.resolve("source.mp4");
        assumeTrue(run("ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=30:duration=2",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                "-shortest", source.toString()) == 0, "ffmpeg 가 시험 영상을 만들지 못해 건너뛴다");
        Path overlay = dir.resolve("frame.png");
        BufferedImage frame = new BufferedImage(1080, 1920, BufferedImage.TYPE_INT_ARGB);
        ImageIO.write(frame, "png", overlay.toFile());
        var composer = new FramedVideoComposer();
        Path out = composer.compose(source, overlay, 1080, 1920, new int[] {90, 228, 900, 1206});
        String probe = output("ffprobe", "-v", "error", "-show_entries", "stream=codec_name,width,height,pix_fmt",
                "-show_entries", "format=duration", "-of", "compact", out.toString());
        assertThat(probe).contains("codec_name=h264|width=1080|height=1920|pix_fmt=yuv420p").contains("codec_name=aac");
        double duration = Double.parseDouble(probe.replaceAll("(?s).*format\\|duration=([0-9.]+).*", "$1"));
        assertThat(duration).isBetween(1.9, 2.2);
        BufferedImage still = ImageIO.read(new ByteArrayInputStream(composer.still(out.toString())));
        assertThat(still.getWidth()).isEqualTo(1080);
    }

    private static boolean ffmpegAvailable() {
        try {
            return run("ffmpeg", "-version") == 0 && run("ffprobe", "-version") == 0;
        } catch (Exception missing) {
            return false;
        }
    }

    private static int run(String... command) throws Exception {
        Process process = new ProcessBuilder(command).redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD).start();
        if (!process.waitFor(60, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            return -1;
        }
        return process.exitValue();
    }

    private static String output(String... command) throws Exception {
        Process process = new ProcessBuilder(command).redirectError(ProcessBuilder.Redirect.DISCARD).start();
        String out = new String(process.getInputStream().readAllBytes(), StandardCharsets.UTF_8);
        process.waitFor(60, TimeUnit.SECONDS);
        return out;
    }
}
