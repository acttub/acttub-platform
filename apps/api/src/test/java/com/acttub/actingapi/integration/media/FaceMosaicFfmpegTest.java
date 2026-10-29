package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * 얼굴 모자이크의 실제 ffmpeg 흐름(challenge.entry 얼굴 모자이크) — 얼굴 찾기만 바꿔 끼운다. ffmpeg 가 없으면 건너뛴다
 * (CI 는 ffmpeg 가 있다). 실제 YuNet 은 {@link YuNetFaceDetectorTest} 가 본다.
 */
class FaceMosaicFfmpegTest {
    @TempDir Path temporary;

    @Test void aVideoWithAFaceComesBackWithTheFaceBlurredAndItsSound() throws Exception {
        Path source = video("take");
        // 프레임 가운데에 늘 얼굴이 있다고 한다.
        var renderer = new FaceMosaicRenderer(() -> (bgr, width, height) ->
                List.of(new FaceDetector.Box(width * 0.4f, height * 0.4f, width * 0.2f, height * 0.2f)));

        Path out = renderer.render(source);

        assertThat(out).exists().hasParent(source.toAbsolutePath().getParent());
        assertThat(Files.size(out)).isPositive();
        assertThat(streams(out)).contains("video", "audio");
        // testsrc 는 x=160 에 파랑→노랑 경계가 세로로 선다. 얼굴 타원(가운데 y≈230) 안에서는 그 경계가 흐려지고,
        // 타원 아래(y=320, 목 자리)에서는 그대로 날카롭다.
        byte[] original = firstFrame(source, 320, 480);
        byte[] frame = firstFrame(out, 320, 480);
        assertThat(maxStep(original, 230)).isGreaterThan(100);
        assertThat(maxStep(frame, 230)).isLessThan(64);
        assertThat(maxStep(frame, 320)).isGreaterThan(100);
        Files.delete(out);
    }

    @Test void aVideoWithoutAFaceIsRefused() throws Exception {
        Path source = video("blank");
        var renderer = new FaceMosaicRenderer(() -> (bgr, width, height) -> List.of());
        assertThat(renderer.available()).isTrue();
        assertThatThrownBy(() -> renderer.render(source)).isInstanceOf(FaceMosaicRenderer.NoFaceFound.class);
    }

    private Path video(String name) throws Exception {
        assumeTrue(ffmpegAvailable(), "ffmpeg 가 없어 실제 모자이크는 건너뛴다");
        Path mp4 = temporary.resolve(name + ".mp4");
        int made = new ProcessBuilder("ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=320x480:rate=30:duration=1",
                "-f", "lavfi", "-i", "sine=frequency=440:duration=1", "-pix_fmt", "yuv420p", "-shortest", mp4.toString())
                .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD)
                .start().waitFor();
        assumeTrue(made == 0 && Files.size(mp4) > 0, "ffmpeg 가 시험 영상을 만들지 못해 건너뛴다");
        return mp4;
    }

    private static String streams(Path file) throws Exception {
        Process probe = new ProcessBuilder("ffprobe", "-v", "error", "-show_entries", "stream=codec_type",
                "-of", "default=noprint_wrappers=1:nokey=1", file.toString()).redirectErrorStream(true).start();
        String out = new String(probe.getInputStream().readAllBytes());
        probe.waitFor(30, TimeUnit.SECONDS);
        return out;
    }

    /** 한 줄의 x 140~180 에서 이웃 화소 사이 파랑 값 차이의 최댓값. */
    private static int maxStep(byte[] frame, int y) {
        int max = 0;
        for (int x = 140; x < 180; x++) {
            int p = (y * 320 + x) * 3;
            max = Math.max(max, Math.abs((frame[p] & 0xff) - (frame[p + 3] & 0xff)));
        }
        return max;
    }

    private static byte[] firstFrame(Path file, int width, int height) throws Exception {
        Process decode = new ProcessBuilder("ffmpeg", "-v", "error", "-i", file.toString(), "-frames:v", "1",
                "-vf", "scale=" + width + ":" + height, "-f", "rawvideo", "-pix_fmt", "bgr24", "-")
                .redirectError(ProcessBuilder.Redirect.DISCARD).start();
        byte[] frame = decode.getInputStream().readAllBytes();
        decode.waitFor(30, TimeUnit.SECONDS);
        assertThat(frame).hasSize(width * height * 3);
        return frame;
    }

    private static boolean ffmpegAvailable() {
        try {
            Process process = new ProcessBuilder(List.of("ffmpeg", "-version"))
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD).start();
            return process.waitFor(10, TimeUnit.SECONDS) && process.exitValue() == 0;
        } catch (Exception missing) {
            return false;
        }
    }
}
