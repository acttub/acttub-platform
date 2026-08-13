package com.acttub.actingapi.analysis;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class FfmpegAudioExtractorTest {

    @TempDir
    Path temporary;

    @Test
    void extractsFirstHundredTwentySecondsWithPythonCommandAndSharedTimeout() throws Exception {
        Path video = Files.writeString(temporary.resolve("take.video"), "video");
        AtomicReference<List<String>> captured = new AtomicReference<>();
        FfmpegAudioExtractor extractor = new FfmpegAudioExtractor(
                name -> "/usr/bin/ffmpeg",
                (command, timeout) -> {
                    captured.set(command);
                    assertThat(timeout).isEqualTo(Duration.ofSeconds(120));
                    Files.writeString(Path.of(command.getLast()), "audio");
                });

        Path audio = extractor.extract(video, 120_000);

        assertThat(audio.getFileName().toString()).isEqualTo("audio.mp3");
        assertThat(captured.get()).containsExactly(
                "/usr/bin/ffmpeg",
                "-hide_banner",
                "-loglevel", "error",
                "-threads", "1",
                "-i", video.toString(),
                "-t", "120.000",
                "-vn",
                "-codec:a", "libmp3lame",
                "-q:a", "4",
                "-y", audio.toString());
        FfmpegAudioExtractor.deleteTree(audio.getParent());
    }
}
