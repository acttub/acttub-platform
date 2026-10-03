package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.BufferedReader;
import java.io.StringReader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;

import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class AudioSignalEvidenceTest {
    @TempDir Path directory;

    @Test void completeDigitalSilenceIsRejected() throws Exception {
        assertThat(signal(frame(0, "-inf", 1024) + frame(1, "-inf", 2048))).isFalse();
    }

    @Test void veryQuietSoundHasNoLoudnessThreshold() throws Exception {
        assertThat(signal(frame(0, "-130.123", 1024))).isTrue();
    }

    @Test void leadingAndTrailingSilenceDoNotHideAShortUtterance() throws Exception {
        assertThat(signal(frame(0, "-inf", 1024) + frame(1, "-70.2", 2048)
                + frame(2, "-70.2", 3072))).isTrue();
    }

    @Test void missingOrIncompleteFramesAreNotAssumedSilent() {
        assertThatThrownBy(() -> signal("unrelated\n")).hasMessageContaining("no decoded audio frames");
        assertThatThrownBy(() -> signal(frame(0, "-inf", 1024) + "frame:1\n"))
                .hasMessageContaining("incomplete audio measurements");
        assertThatThrownBy(() -> signal("frame:0\nlavfi.astats.Overall.Peak_level=-inf\n"))
                .hasMessageContaining("incomplete audio measurements");
    }

    @Test void earlierSoundCannotBypassAnIncompleteFinalMeasurement() {
        assertThatThrownBy(() -> signal(frame(0, "-20", 1024) + "frame:1\n"))
                .hasMessageContaining("incomplete audio measurements");
    }

    @Test void invalidPeaksAndSamplesCannotPass() {
        assertThatThrownBy(() -> signal(frame(0, "NaN", 1024))).hasMessageContaining("invalid audio peak");
        assertThatThrownBy(() -> signal(frame(0, "Infinity", 1024))).hasMessageContaining("invalid audio peak");
        assertThatThrownBy(() -> signal(frame(0, "-inf", 0))).hasMessageContaining("invalid audio sample count");
        assertThatThrownBy(() -> signal(frame(0, "-20", 1024) + frame(1, "-20", 1024)))
                .hasMessageContaining("invalid audio sample count");
    }

    @Test void duplicateMeasurementsCannotManufactureCompleteness() {
        assertThatThrownBy(() -> signal(frame(0, "-inf", 1024) + "lavfi.astats.Overall.Peak_level=-inf\n"))
                .hasMessageContaining("invalid audio measurements");
    }

    @Test void nonFiniteSamplesAreRejectedEvenWhenOtherSamplesHaveSound() {
        assertThatThrownBy(() -> signal(frame(0, "-20", 1024) + "lavfi.astats.1.Number of NaNs=1\n"))
                .hasMessageContaining("non-finite audio samples");
        assertThatThrownBy(() -> signal(frame(0, "-20", 1024) + "lavfi.astats.2.Number of Infs=1\n"))
                .hasMessageContaining("non-finite audio samples");
    }

    @Test void realDecoderRejectsAnExistingButSilentAudioTrack() throws Exception {
        requireFfmpeg();
        assertThat(new AudioSignalEvidence().hasSignal(audio("silent", "anullsrc=r=48000:cl=stereo:d=0.2")))
                .isFalse();
    }

    @Test void realDecoderPreservesNormalAndVeryQuietSound() throws Exception {
        requireFfmpeg();
        var evidence = new AudioSignalEvidence();
        assertThat(evidence.hasSignal(audio("normal", "sine=frequency=440:duration=0.2"))).isTrue();
        assertThat(evidence.hasSignal(audio("quiet", "sine=frequency=440:duration=0.2,volume=0.0000001"))).isTrue();
    }

    @Test void realDecoderPreservesSoundBetweenSilences() throws Exception {
        requireFfmpeg();
        assertThat(new AudioSignalEvidence().hasSignal(audio("pauses",
                "aevalsrc='if(between(t,0.03,0.08),0.02*sin(2*PI*440*t),0)':s=48000:d=0.2"))).isTrue();
    }

    @Test void stereoChannelsMustNotCancelEachOtherInADownmix() throws Exception {
        requireFfmpeg();
        assertThat(new AudioSignalEvidence().hasSignal(audio("opposite-phase",
                "aevalsrc=0.02*sin(2*PI*440*t)|-0.02*sin(2*PI*440*t):s=48000:d=0.2"))).isTrue();
    }

    @Test void realDecoderRejectsDamagedAudioEvenAfterValidSamples() throws Exception {
        requireFfmpeg();
        Path valid = audio("valid", "sine=frequency=440:duration=0.2");
        byte[] bytes = Files.readAllBytes(valid);
        Path damaged = directory.resolve("damaged.wav");
        Files.write(damaged, java.util.Arrays.copyOf(bytes, bytes.length - 1));
        assertThatThrownBy(() -> new AudioSignalEvidence().hasSignal(damaged))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("audio signal inspection failed");
    }

    @Test void realDecoderRejectsNonFiniteAudioSamples() throws Exception {
        requireFfmpeg();
        Path source = audio("nan", "aevalsrc=0/0:s=48000:d=0.2");
        assertThatThrownBy(() -> new AudioSignalEvidence().hasSignal(source))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("audio signal inspection failed");
    }

    @Test void unreadableInputIsNotSilence() {
        requireFfmpeg();
        assertThatThrownBy(() -> new AudioSignalEvidence().hasSignal(directory.resolve("missing.wav")))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("audio signal inspection failed");
    }

    private static String frame(int index, String peak, int samples) {
        return "frame:" + index + "\nlavfi.astats.Overall.Peak_level=" + peak
                + "\nlavfi.astats.Overall.Number_of_samples=" + samples + ".000000\n";
    }

    private static boolean signal(String metadata) throws Exception {
        return AudioSignalEvidence.hasSignal(new BufferedReader(new StringReader(metadata)));
    }

    private Path audio(String name, String input) throws Exception {
        Path target = directory.resolve(name + ".wav");
        Process process = new ProcessBuilder(List.of("ffmpeg", "-y", "-f", "lavfi", "-i", input,
                "-c:a", "pcm_f32le", target.toString())).redirectOutput(ProcessBuilder.Redirect.DISCARD)
                .redirectError(ProcessBuilder.Redirect.DISCARD).start();
        try {
            assertThat(process.waitFor(20, TimeUnit.SECONDS)).isTrue();
            assertThat(process.exitValue()).isZero();
            return target;
        } finally { if (process.isAlive()) process.destroyForcibly(); }
    }

    private static void requireFfmpeg() {
        boolean available = false;
        Process process = null;
        try {
            process = new ProcessBuilder("ffmpeg", "-version").redirectOutput(ProcessBuilder.Redirect.DISCARD)
                    .redirectError(ProcessBuilder.Redirect.DISCARD).start();
            available = process.waitFor(10, TimeUnit.SECONDS) && process.exitValue() == 0;
        } catch (Exception failure) {
            if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
        } finally { if (process != null && process.isAlive()) process.destroyForcibly(); }
        if ("true".equals(System.getenv("CI")) && !available) throw new IllegalStateException("ffmpeg must be available in CI");
        Assumptions.assumeTrue(available, "ffmpeg not available locally");
    }
}
