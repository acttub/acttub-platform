package com.acttub.actingapi.integration.media;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** Decodes the full original audio without downmixing or a quiet-voice threshold. Not speech recognition. */
public final class AudioSignalEvidence {
    private static final String PEAK = "lavfi.astats.Overall.Peak_level=";
    private static final String SAMPLES = "lavfi.astats.Overall.Number_of_samples=";

    public boolean hasSignal(Path source) {
        Path metadata = null;
        try {
            metadata = Files.createTempFile("coach-audio-evidence-", ".txt");
            Path output = metadata;
            FfmpegLock.run(() -> {
                run(List.of("ffmpeg", "-hide_banner", "-nostdin", "-xerror", "-loglevel", "error",
                        "-threads", "1", "-i", source.toString(), "-map", "0:a:0", "-vn",
                        "-af", "astats=metadata=1:reset=0:measure_perchannel=Number_of_NaNs+Number_of_Infs:"
                                + "measure_overall=Peak_level+Number_of_samples,ametadata=mode=print:file=-",
                        "-f", "null", "-"), output);
                return null;
            });
            try (BufferedReader lines = Files.newBufferedReader(metadata)) {
                return hasSignal(lines);
            }
        } catch (Exception failure) {
            if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
            throw new IllegalStateException("audio signal inspection failed", failure);
        } finally {
            if (metadata != null) {
                try { Files.deleteIfExists(metadata); }
                catch (IOException cleanup) { metadata.toFile().deleteOnExit(); }
            }
        }
    }

    /** Every frame must have cumulative sample and peak measurements, including the final frame. */
    static boolean hasSignal(BufferedReader lines) throws IOException {
        int frames = 0;
        int peaks = 0;
        int counts = 0;
        double samples = 0;
        double maximum = Double.NEGATIVE_INFINITY;
        boolean framePeak = false;
        boolean frameSamples = false;
        String line;
        while ((line = lines.readLine()) != null) {
            if (line.startsWith("frame:")) {
                if (frames > 0 && (!framePeak || !frameSamples)) throw new IOException("incomplete audio measurements");
                frames++;
                framePeak = false;
                frameSamples = false;
            } else if (line.startsWith(PEAK)) {
                if (frames == 0 || framePeak) throw new IOException("invalid audio measurements");
                String value = line.substring(PEAK.length()).strip();
                double peak = "-inf".equals(value) ? Double.NEGATIVE_INFINITY : Double.parseDouble(value);
                if (Double.isNaN(peak) || peak == Double.POSITIVE_INFINITY) throw new IOException("invalid audio peak");
                maximum = Math.max(maximum, peak);
                peaks++;
                framePeak = true;
            } else if (line.startsWith(SAMPLES)) {
                if (frames == 0 || frameSamples) throw new IOException("invalid audio measurements");
                double count = Double.parseDouble(line.substring(SAMPLES.length()).strip());
                if (!Double.isFinite(count) || count <= samples || count != Math.rint(count)) {
                    throw new IOException("invalid audio sample count");
                }
                samples = count;
                counts++;
                frameSamples = true;
            } else if (line.startsWith("lavfi.astats.")
                    && (line.contains(".Number of NaNs=") || line.contains(".Number of Infs="))) {
                double invalid = Double.parseDouble(line.substring(line.indexOf('=') + 1).strip());
                if (invalid != 0) throw new IOException("non-finite audio samples");
            }
        }
        if (frames == 0) throw new IOException("no decoded audio frames");
        if (frames != peaks || frames != counts || !framePeak || !frameSamples) {
            throw new IOException("incomplete audio measurements");
        }
        // Only exact zero throughout the entire recording is silence. Never reject whispers by loudness.
        return maximum != Double.NEGATIVE_INFINITY;
    }

    private static void run(List<String> command, Path output) throws IOException, InterruptedException {
        Process process = new ProcessBuilder(command).redirectOutput(output.toFile())
                .redirectError(ProcessBuilder.Redirect.DISCARD).start();
        try {
            if (!process.waitFor(90, TimeUnit.SECONDS) || process.exitValue() != 0) {
                throw new IOException("audio signal command failed");
            }
        } finally {
            if (process.isAlive()) {
                process.destroyForcibly();
                process.waitFor();
            }
        }
    }
}
