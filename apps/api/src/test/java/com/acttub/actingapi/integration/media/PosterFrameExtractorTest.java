package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

import javax.imageio.ImageIO;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * 보관함 포스터의 첫 장면 추출(practice.library). 명령의 모양과 실패 정리는 흉내 낸 실행기로, 진짜 추출은 이 머신의
 * ffmpeg 로 본다 — ffmpeg 가 없으면 그 하나는 건너뛰고 보고서에 남긴다.
 */
class PosterFrameExtractorTest {
    @TempDir Path temporary;

    @Test
    @DisplayName("practice.library: 0.5초 자리의 한 장면을 폭 480 이하 JPEG 로 뽑는 ffmpeg 명령을 한 스레드로 부르고 원본은 그대로 둔다")
    void extractsOneScaledFrameWithOneThread() throws Exception {
        Path source = Files.writeString(temporary.resolve("take.mp4"), "mp4");
        var extractor = new PosterFrameExtractor((command, timeout) -> {
            assertThat(command).containsExactly("ffmpeg", "-y", "-threads", "1", "-ss", "0.5", "-i", source.toString(),
                    "-frames:v", "1", "-vf", "scale='min(480,iw)':-2", "-q:v", "4", "-an", "-threads", "1",
                    command.getLast());
            assertThat(command.getLast()).endsWith(".jpg");
            assertThat(timeout).isEqualTo(Duration.ofSeconds(60));
            Files.writeString(Path.of(command.getLast()), "jpeg");
        });

        Path output = extractor.extract(source, 12_000);

        assertThat(output).exists().hasExtension("jpg").hasParent(source.toAbsolutePath().getParent());
        assertThat(source).hasContent("mp4");
    }

    @Test
    @DisplayName("practice.library: 1초보다 짧거나 길이를 모르는 영상은 맨 앞 장면을 뽑는다 — 0.5초 뒤에는 장면이 없을 수 있다")
    void shortOrUnknownVideosUseTheFirstFrame() throws Exception {
        Path source = Files.writeString(temporary.resolve("take.mp4"), "mp4");
        var seeks = new java.util.ArrayList<String>();
        var extractor = new PosterFrameExtractor((command, timeout) -> {
            seeks.add(command.get(command.indexOf("-ss") + 1));
            Files.writeString(Path.of(command.getLast()), "jpeg");
        });

        Files.delete(extractor.extract(source, 900));
        Files.delete(extractor.extract(source, 0));
        Files.delete(extractor.extract(source, 1_000));

        assertThat(seeks).containsExactly("0", "0", "0.5");
    }

    @Test
    @DisplayName("practice.library: 추출이 실패하거나 빈 파일이면 부분 출력을 지우고 원인을 담아 던진다")
    void failedOrEmptyExtractionRemovesPartialOutput() throws Exception {
        Path source = Files.writeString(temporary.resolve("take.mp4"), "mp4");
        var failure = new IOException("ffmpeg exited with status 1");
        var output = new AtomicReference<Path>();
        var extractor = new PosterFrameExtractor((command, timeout) -> {
            output.set(Path.of(command.getLast()));
            Files.writeString(output.get(), "partial");
            throw failure;
        });
        assertThatThrownBy(() -> extractor.extract(source, 5_000))
                .isInstanceOf(PosterFrameExtractor.ExtractionFailed.class).hasCause(failure);
        assertThat(output.get()).doesNotExist();

        var empty = new PosterFrameExtractor((command, timeout) -> output.set(Path.of(command.getLast())));
        assertThatThrownBy(() -> empty.extract(source, 5_000))
                .isInstanceOf(PosterFrameExtractor.ExtractionFailed.class)
                .hasRootCauseMessage("ffmpeg produced an empty poster");
        assertThat(output.get()).doesNotExist();
    }

    /** 실제 ffmpeg — 2초짜리 세로 영상(720x1280)을 만들어 포스터를 뽑는다. ffmpeg 가 없으면 건너뛴다. */
    @Test
    @DisplayName("practice.library: 세로 720x1280 MP4 에서 480x854 JPEG 한 장이 나온다 (실제 ffmpeg)")
    void aRealPortraitMp4BecomesA480WideJpeg() throws Exception {
        assumeTrue(ffmpegAvailable(), "ffmpeg 가 없어 실제 추출은 건너뛴다");
        Path mp4 = temporary.resolve("take.mp4");
        int made = new ProcessBuilder("ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=720x1280:rate=30:duration=2",
                "-pix_fmt", "yuv420p", mp4.toString())
                .redirectOutput(ProcessBuilder.Redirect.DISCARD).redirectError(ProcessBuilder.Redirect.DISCARD)
                .start().waitFor();
        assumeTrue(made == 0 && Files.size(mp4) > 0, "ffmpeg 가 시험 영상을 만들지 못해 건너뛴다");

        Path jpeg = new PosterFrameExtractor().extract(mp4, 2_000);

        var image = ImageIO.read(jpeg.toFile());
        assertThat(image).as("JPEG 로 읽힌다").isNotNull();
        assertThat(image.getWidth()).isEqualTo(480);
        assertThat(image.getHeight()).isEqualTo(854);
        Files.delete(jpeg);
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
