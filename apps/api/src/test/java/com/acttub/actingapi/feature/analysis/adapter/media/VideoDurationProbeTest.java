package com.acttub.actingapi.feature.analysis.adapter.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import com.acttub.actingapi.feature.analysis.app.UnsupportedMediaError;
import org.junit.jupiter.api.Test;

class VideoDurationProbeTest {

    @Test
    void declaredPositiveDurationWinsWithoutRunningFfprobe() {
        VideoDurationProbe probe = new VideoDurationProbe(
                name -> { throw new AssertionError("ffprobe must not be searched"); },
                (command, timeout) -> { throw new AssertionError("ffprobe must not run"); });

        assertThat(probe.durationMs(Path.of("take.video"), 1234)).isEqualTo(1234);
    }

    @Test
    void probesAndUsesPythonHalfEvenRounding() {
        AtomicReference<List<String>> captured = new AtomicReference<>();
        VideoDurationProbe probe = new VideoDurationProbe(
                name -> "/usr/bin/ffprobe",
                (command, timeout) -> {
                    captured.set(command);
                    assertThat(timeout).isEqualTo(Duration.ofSeconds(30));
                    return "1.2345\n";
                });

        assertThat(probe.durationMs(Path.of("take.video"), null)).isEqualTo(1234);
        assertThat(captured.get()).containsExactly(
                "/usr/bin/ffprobe", "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", "take.video");
    }

    @Test
    void missingFailedOrNonPositiveProbeIsUnsupportedMedia() {
        assertThatThrownBy(() -> new VideoDurationProbe(name -> null, (command, timeout) -> "1")
                .durationMs(Path.of("take.video"), null))
                .isInstanceOf(UnsupportedMediaError.class);
        assertThatThrownBy(() -> new VideoDurationProbe(name -> "ffprobe", (command, timeout) -> "0")
                .durationMs(Path.of("take.video"), null))
                .isInstanceOf(UnsupportedMediaError.class);
        assertThatThrownBy(() -> new VideoDurationProbe(name -> "ffprobe", (command, timeout) -> {
                    throw new IllegalStateException("failed");
                }).durationMs(Path.of("take.video"), null))
                .isInstanceOf(UnsupportedMediaError.class);
    }
}
