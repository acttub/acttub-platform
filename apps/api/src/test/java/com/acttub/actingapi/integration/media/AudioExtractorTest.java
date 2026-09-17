package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.concurrent.atomic.AtomicReference;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AudioExtractorTest {
    @TempDir Path temporary;

    @Test
    void extractsMonoPcmWithOneThreadAndPreservesOriginal() throws Exception {
        Path video = Files.writeString(temporary.resolve("take.mp4"), "video");
        var extractor = new AudioExtractor((command, timeout) -> {
            assertThat(command).containsExactly("ffmpeg", "-y", "-threads", "1", "-i", video.toString(),
                    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-threads", "1",
                    command.getLast());
            assertThat(timeout).isEqualTo(Duration.ofSeconds(600));
            Files.writeString(Path.of(command.getLast()), "wav");
        });

        Path audio = extractor.extract(video);

        assertThat(audio).exists().hasExtension("wav");
        assertThat(video).hasContent("video");
        Files.delete(audio);
    }

    @Test
    void failedOrEmptyExtractionRemovesPartialAudioAndRetainsCause() throws Exception {
        Path video = Files.writeString(temporary.resolve("take.mp4"), "video");
        var failure = new IOException("ffmpeg failed");
        var output = new AtomicReference<Path>();
        var extractor = new AudioExtractor((command, timeout) -> {
            output.set(Path.of(command.getLast()));
            Files.writeString(output.get(), "partial");
            throw failure;
        });
        assertThatThrownBy(() -> extractor.extract(video)).hasCause(failure);
        assertThat(output.get()).doesNotExist();
        assertThat(video).exists();

        var empty = new AudioExtractor((command, timeout) -> output.set(Path.of(command.getLast())));
        assertThatThrownBy(() -> empty.extract(video)).hasRootCauseMessage("ffmpeg produced empty audio");
        assertThat(output.get()).doesNotExist();
    }
}
