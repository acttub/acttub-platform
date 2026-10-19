package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** 실제 ffmpeg·ffprobe 로 청크 자르기와 소리 트랙 확인을 본다. 둘이 없으면 건너뛴다(CI 는 설치한다). */
class VideoRecordChunksTest {
    @TempDir
    Path directory;

    private final VideoRecordChunks chunks = new VideoRecordChunks();

    @Test
    void cutsTheRequestedSpanNextToTheSourceAndKeepsTheAudio() throws Exception {
        Path source = video("with-audio.mp4", true);

        Path chunk = chunks.extract(source, 500, 1_500);

        assertThat(chunk.getParent()).isEqualTo(directory);
        assertThat(chunk.getFileName().toString()).startsWith("acttub-record-").endsWith(".mp4");
        assertThat(Files.size(chunk)).isPositive();
        assertThat(durationSeconds(chunk)).isBetween(0.9, 1.2);
        assertThat(chunks.hasAudio(chunk)).isTrue();
    }

    @Test
    void videoWithoutASoundTrackHasNoAudio() throws Exception {
        assertThat(chunks.hasAudio(video("silent-track.mp4", false))).isFalse();
    }

    @Test
    void unreadableSourceFailsAndLeavesNoPartialChunk() throws Exception {
        assumeTrue(available("ffmpeg") && available("ffprobe"), "ffmpeg/ffprobe 가 없다");
        Path broken = Files.writeString(directory.resolve("broken.mp4"), "not a video", StandardCharsets.UTF_8);

        assertThatThrownBy(() -> chunks.extract(broken, 0, 1_000))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("video chunk extraction failed");
        assertThatThrownBy(() -> chunks.hasAudio(broken))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("audio track probe failed");
        try (Stream<Path> files = Files.list(directory)) {
            assertThat(files.map(path -> path.getFileName().toString())).containsExactly("broken.mp4");
        }
    }

    private Path video(String name, boolean audio) throws Exception {
        assumeTrue(available("ffmpeg") && available("ffprobe"), "ffmpeg/ffprobe 가 없다");
        Path output = directory.resolve(name);
        List<String> command = audio
                ? List.of("ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=2",
                        "-f", "lavfi", "-i", "sine=frequency=440:duration=2",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", output.toString())
                : List.of("ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=15:duration=2",
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", output.toString());
        int exit = new ProcessBuilder(command).redirectErrorStream(true)
                .redirectOutput(ProcessBuilder.Redirect.DISCARD).start().waitFor();
        assumeTrue(exit == 0 && Files.size(output) > 0, "ffmpeg 가 시험 영상을 만들지 못했다");
        return output;
    }

    private static double durationSeconds(Path video) throws Exception {
        Process probe = new ProcessBuilder("ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "csv=p=0", video.toString()).start();
        String out = new String(probe.getInputStream().readAllBytes(), StandardCharsets.UTF_8).strip();
        probe.waitFor();
        return Double.parseDouble(out);
    }

    private static boolean available(String tool) {
        try {
            return new ProcessBuilder(tool, "-version").redirectErrorStream(true)
                    .redirectOutput(ProcessBuilder.Redirect.DISCARD).start().waitFor() == 0;
        } catch (Exception missing) {
            return false;
        }
    }
}
