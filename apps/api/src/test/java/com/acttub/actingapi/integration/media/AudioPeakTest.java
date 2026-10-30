package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.StringReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** ffmpeg astats 의 누적 최댓값을 읽는다 — 마지막 프레임 값이 전체 최댓값이다. */
class AudioPeakTest {

    @Test
    void readsTheLastCumulativePeak() throws IOException {
        String printed = """
                frame:0    pts:0       pts_time:0
                lavfi.astats.Overall.Peak_level=-48.120000
                frame:1    pts:1024    pts_time:0.064
                lavfi.astats.Overall.Peak_level=-12.500000
                """;
        assertThat(AudioPeak.lastPeak(new BufferedReader(new StringReader(printed)))).isEqualTo(-12.5);
    }

    @Test
    void digitalSilenceIsNegativeInfinity() throws IOException {
        String printed = "frame:0\nlavfi.astats.Overall.Peak_level=-inf\n";
        assertThat(AudioPeak.lastPeak(new BufferedReader(new StringReader(printed)))).isEqualTo(Double.NEGATIVE_INFINITY);
    }

    @Test
    void noMeasurementIsAFailure() {
        assertThatThrownBy(() -> AudioPeak.lastPeak(new BufferedReader(new StringReader("frame:0\n"))))
                .isInstanceOf(IOException.class);
    }

    @TempDir
    Path temporary;

    /** 실제 ffmpeg — 소리 있는 m4a 와 무음 m4a 를 만들어 잰다. ffmpeg 가 없으면 건너뛴다. */
    @Test
    void measuresARealToneAndRealSilence() throws Exception {
        assumeTrue(ffmpegAvailable(), "ffmpeg 가 없어 실제 측정은 건너뛴다");
        Path tone = make("tone.m4a", List.of("-f", "lavfi", "-i", "sine=frequency=440:duration=1"));
        Path silence = make("silence.m4a", List.of("-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1"));
        assumeTrue(tone != null && silence != null, "ffmpeg 가 aac 파일을 만들지 못해 건너뛴다");

        AudioPeak peak = new AudioPeak();

        assertThat(peak.peakDb(tone)).isBetween(-40.0, 0.0);
        assertThat(peak.peakDb(silence)).isEqualTo(Double.NEGATIVE_INFINITY);
    }

    @Test
    void unreadableFileFails() throws Exception {
        assumeTrue(ffmpegAvailable(), "ffmpeg 가 없어 건너뛴다");
        Path broken = Files.writeString(temporary.resolve("broken.m4a"), "not audio");
        assertThatThrownBy(() -> new AudioPeak().peakDb(broken)).isInstanceOf(IllegalStateException.class);
    }

    private Path make(String name, List<String> input) throws Exception {
        Path out = temporary.resolve(name);
        List<String> command = new java.util.ArrayList<>(List.of("ffmpeg", "-y", "-loglevel", "error"));
        command.addAll(input);
        command.addAll(List.of("-c:a", "aac", out.toString()));
        int status = new ProcessBuilder(command).redirectOutput(ProcessBuilder.Redirect.DISCARD)
                .redirectError(ProcessBuilder.Redirect.DISCARD).start().waitFor();
        return status == 0 && Files.size(out) > 0 ? out : null;
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
