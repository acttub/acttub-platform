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

/** 실제 ffmpeg 로 소리 있음·완전한 무음·읽을 수 없는 파일을 가르고, 측정 줄이 어긋난 경우를 더 본다. */
class AudioSignalEvidenceFfmpegTest {
    @TempDir
    Path directory;

    private final AudioSignalEvidence evidence = new AudioSignalEvidence();

    @Test
    void quietToneHasSignalAndDigitalSilenceDoesNot() throws Exception {
        Path tone = audio("tone.m4a", "sine=frequency=440:duration=1,volume=0.01");
        Path silence = audio("silence.m4a", "anullsrc=r=44100:cl=mono:d=1");

        assertThat(evidence.hasSignal(tone)).isTrue();
        assertThat(evidence.hasSignal(silence)).isFalse();
    }

    @Test
    void fileWithoutDecodableAudioIsAnInspectionFailureNotSilence() throws Exception {
        assumeTrue(ffmpegAvailable(), "ffmpeg 가 없다");
        Path text = Files.writeString(directory.resolve("note.m4a"), "not audio");

        assertThatThrownBy(() -> evidence.hasSignal(text))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("audio signal inspection failed");
    }

    @Test
    void interruptedInspectionFailsAndKeepsTheInterrupt() throws Exception {
        Path tone = audio("interrupted.m4a", "sine=frequency=440:duration=1");

        Thread.currentThread().interrupt();
        try {
            assertThatThrownBy(() -> evidence.hasSignal(tone))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("audio signal inspection failed");
            assertThat(Thread.interrupted()).isTrue();
        } finally {
            Thread.interrupted();
        }
    }

    @Test
    void measurementsOutsideAFrameOrRepeatedOrFractionalAreRejected() {
        assertThatThrownBy(() -> parse("lavfi.astats.Overall.Peak_level=-20\n"))
                .hasMessage("invalid audio measurements");
        assertThatThrownBy(() -> parse("lavfi.astats.Overall.Number_of_samples=1024\n"))
                .hasMessage("invalid audio measurements");
        assertThatThrownBy(() -> parse("frame:0\nlavfi.astats.Overall.Number_of_samples=1024\n"
                + "lavfi.astats.Overall.Number_of_samples=2048\n"))
                .hasMessage("invalid audio measurements");
        assertThatThrownBy(() -> parse("frame:0\nlavfi.astats.Overall.Peak_level=-20\n"
                + "lavfi.astats.Overall.Number_of_samples=1024.5\n"))
                .hasMessage("invalid audio sample count");
        assertThatThrownBy(() -> parse("frame:0\nlavfi.astats.Overall.Peak_level=-20\n"
                + "lavfi.astats.Overall.Number_of_samples=1024\nlavfi.astats.2.Number of Infs=2\n"))
                .hasMessage("non-finite audio samples");
        assertThatThrownBy(() -> parse("frame:0\nlavfi.astats.Overall.Number_of_samples=1024\n"))
                .hasMessage("incomplete audio measurements");
    }

    private static boolean parse(String lines) throws Exception {
        return AudioSignalEvidence.hasSignal(new BufferedReader(new StringReader(lines)));
    }

    private Path audio(String name, String source) throws Exception {
        assumeTrue(ffmpegAvailable(), "ffmpeg 가 없다");
        Path output = directory.resolve(name);
        int exit = new ProcessBuilder(List.of("ffmpeg", "-y", "-f", "lavfi", "-i", source, "-c:a", "aac",
                output.toString())).redirectErrorStream(true).redirectOutput(ProcessBuilder.Redirect.DISCARD)
                .start().waitFor();
        assumeTrue(exit == 0 && Files.size(output) > 0, "ffmpeg 가 시험 소리를 만들지 못했다");
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
