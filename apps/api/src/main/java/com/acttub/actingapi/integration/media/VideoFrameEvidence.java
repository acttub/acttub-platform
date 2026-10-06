package com.acttub.actingapi.integration.media;

import java.io.BufferedReader;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.TimeUnit;

/** Measures every decoded frame. An average brightness or sampled frame cannot reject a dark performance. */
public final class VideoFrameEvidence {
    private static final String MAX_LUMA = "lavfi.signalstats.YMAX=";

    public boolean entirelyBlack(Path source) {
        Path metadata = null;
        try {
            metadata = Files.createTempFile("coach-frame-evidence-", ".txt");
            Path output = metadata;
            FfmpegLock.run(() -> {
                run(List.of("ffmpeg", "-hide_banner", "-nostdin", "-xerror", "-loglevel", "error",
                        "-threads", "1", "-i", source.toString(), "-map", "0:v:0", "-an",
                        "-vf", "format=yuv444p,scale=in_range=auto:out_range=full,signalstats,"
                                + "metadata=mode=print:key=lavfi.signalstats.YMAX:file=-",
                        "-f", "null", "-"), output);
                return null;
            });
            try (BufferedReader lines = Files.newBufferedReader(metadata)) {
                return entirelyBlack(lines);
            }
        } catch (Exception failure) {
            if (failure instanceof InterruptedException) Thread.currentThread().interrupt();
            throw new IllegalStateException("video frame inspection failed", failure);
        } finally {
            if (metadata != null) {
                try { Files.deleteIfExists(metadata); }
                catch (IOException cleanup) { metadata.toFile().deleteOnExit(); }
            }
        }
    }

    /** Full-range 8-bit maximum luma must be exactly zero in every frame, not merely low. */
    static boolean entirelyBlack(BufferedReader lines) throws IOException {
        int frames = 0;
        int frameHeaders = 0;
        boolean black = true;
        String line;
        while ((line = lines.readLine()) != null) {
            if (line.startsWith("frame:")) frameHeaders++;
            if (!line.startsWith(MAX_LUMA)) continue;
            int max = Integer.parseInt(line.substring(MAX_LUMA.length()).strip());
            if (max < 0 || max > 255) throw new IOException("invalid frame luminance");
            frames++;
            if (max != 0) black = false;
        }
        if (frames == 0) throw new IOException("no decoded video frames");
        if (frames != frameHeaders) throw new IOException("incomplete frame measurements");
        return black;
    }

    private static void run(List<String> command, Path output) throws IOException, InterruptedException {
        Process process = new ProcessBuilder(command).redirectOutput(output.toFile())
                .redirectError(ProcessBuilder.Redirect.DISCARD).start();
        try {
            if (!process.waitFor(90, TimeUnit.SECONDS) || process.exitValue() != 0) {
                throw new IOException("video frame command failed");
            }
        } finally {
            if (process.isAlive()) {
                process.destroyForcibly();
                process.waitFor();
            }
        }
    }
}
