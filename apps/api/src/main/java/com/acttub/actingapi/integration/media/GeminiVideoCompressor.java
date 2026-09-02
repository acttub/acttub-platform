package com.acttub.actingapi.integration.media;

import java.io.File;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;

/** {@code acting-summary/compress.py:compress_for_gemini} 대응. */
public final class GeminiVideoCompressor {

    public static final long MIN_BYTES = 15L * 1024 * 1024;
    public static final Duration TIMEOUT = Duration.ofSeconds(600);

    private final long minBytes;
    private final Duration timeout;
    private final ExecutableFinder executableFinder;
    private final CommandRunner commandRunner;
    private final FailureReporter failureReporter;

    public GeminiVideoCompressor(FailureReporter failureReporter) {
        this(MIN_BYTES, TIMEOUT, GeminiVideoCompressor::findExecutable,
                GeminiVideoCompressor::runCommand, failureReporter);
    }

    GeminiVideoCompressor(
            long minBytes,
            Duration timeout,
            ExecutableFinder executableFinder,
            CommandRunner commandRunner,
            FailureReporter failureReporter) {
        this.minBytes = minBytes;
        this.timeout = timeout;
        this.executableFinder = executableFinder;
        this.commandRunner = commandRunner;
        this.failureReporter = failureReporter;
    }

    public Path compress(Path videoPath) {
        long originalSize = size(videoPath);
        if (originalSize <= minBytes) {
            return videoPath;
        }

        String ffmpeg = executableFinder.find("ffmpeg");
        if (ffmpeg == null) {
            return videoPath;
        }

        Path output = outputPath(videoPath);
        List<String> command = List.of(
                ffmpeg,
                "-y",
                "-threads", "1",
                "-i", videoPath.toString(),
                "-vf", "scale=w=768:h=768:force_original_aspect_ratio=decrease:force_divisible_by=2",
                "-r", "10",
                "-c:v", "libx264",
                "-preset", "ultrafast",
                "-crf", "28",
                "-pix_fmt", "yuv420p",
                "-c:a", "aac",
                "-b:a", "64k",
                "-ac", "1",
                "-movflags", "+faststart",
                "-threads", "1",
                output.toString());
        try {
            FfmpegLock.run(() -> {
                commandRunner.run(command, timeout);
                return null;
            });
        } catch (Exception exc) {
            deleteOutput(output);
            failureReporter.report(
                    exc,
                    FailureKind.UNEXPECTED,
                    new FailureContext("GeminiVideoCompressor.compress"));
            return videoPath;
        }

        if (!Files.exists(output) || size(output) == 0) {
            deleteOutput(output);
            return videoPath;
        }
        if (size(output) >= originalSize) {
            deleteOutput(output);
            return videoPath;
        }
        return output;
    }

    private static Path outputPath(Path source) {
        String name = source.getFileName().toString();
        int suffix = name.lastIndexOf('.');
        String stem = suffix > 0 ? name.substring(0, suffix) : name;
        return source.resolveSibling(stem + ".gemini.mp4");
    }

    private static long size(Path path) {
        try {
            return Files.size(path);
        } catch (IOException exc) {
            throw new UncheckedIOException(exc);
        }
    }

    private static void deleteOutput(Path output) {
        try {
            Files.deleteIfExists(output);
        } catch (IOException ignored) {
            // 압축 실패의 계약은 원본 폴백이다.
        }
    }

    private static String findExecutable(String command) {
        String path = System.getenv("PATH");
        if (path == null) {
            return null;
        }
        for (String directory : path.split(java.util.regex.Pattern.quote(File.pathSeparator))) {
            Path candidate = Path.of(directory, command);
            if (Files.isRegularFile(candidate) && Files.isExecutable(candidate)) {
                return candidate.toString();
            }
        }
        return null;
    }

    private static void runCommand(List<String> command, Duration timeout) throws Exception {
        Process process = new ProcessBuilder(command)
                .redirectOutput(ProcessBuilder.Redirect.DISCARD)
                .redirectError(ProcessBuilder.Redirect.DISCARD)
                .start();
        if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
            process.destroyForcibly();
            process.waitFor();
            throw new TimeoutException("ffmpeg timed out");
        }
        if (process.exitValue() != 0) {
            throw new IOException("ffmpeg exited with status " + process.exitValue());
        }
    }

    @FunctionalInterface
    interface ExecutableFinder {
        String find(String command);
    }

    @FunctionalInterface
    interface CommandRunner {
        void run(List<String> command, Duration timeout) throws Exception;
    }
}
