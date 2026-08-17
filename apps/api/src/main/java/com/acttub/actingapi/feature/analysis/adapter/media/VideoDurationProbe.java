package com.acttub.actingapi.feature.analysis.adapter.media;

import java.io.File;
import java.io.IOException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import com.acttub.actingapi.feature.analysis.app.DurationResolver;
import com.acttub.actingapi.feature.analysis.app.UnsupportedMediaError;

public final class VideoDurationProbe implements DurationResolver {
    static final Duration TIMEOUT = Duration.ofSeconds(30);

    private final ExecutableFinder executableFinder;
    private final CommandRunner commandRunner;

    public VideoDurationProbe() {
        this(VideoDurationProbe::findExecutable, VideoDurationProbe::runCommand);
    }

    VideoDurationProbe(ExecutableFinder executableFinder, CommandRunner commandRunner) {
        this.executableFinder = executableFinder;
        this.commandRunner = commandRunner;
    }

    @Override
    public int durationMs(Path videoPath, Integer declaredDurationMs) {
        if (declaredDurationMs != null && declaredDurationMs > 0) {
            return declaredDurationMs;
        }
        String ffprobe = executableFinder.find("ffprobe");
        if (ffprobe == null) {
            throw unavailable(null);
        }
        try {
            String output = commandRunner.run(List.of(
                    ffprobe,
                    "-v", "error",
                    "-show_entries", "format=duration",
                    "-of", "default=noprint_wrappers=1:nokey=1",
                    videoPath.toString()), TIMEOUT);
            int duration = new BigDecimal(output.strip())
                    .multiply(BigDecimal.valueOf(1000))
                    .setScale(0, RoundingMode.HALF_EVEN)
                    .intValueExact();
            if (duration <= 0) {
                throw unavailable(null);
            }
            return duration;
        } catch (UnsupportedMediaError exception) {
            throw exception;
        } catch (Exception exception) {
            throw unavailable(exception);
        }
    }

    private static UnsupportedMediaError unavailable(Throwable cause) {
        return cause == null
                ? new UnsupportedMediaError("video duration is unavailable")
                : new UnsupportedMediaError("video duration is unavailable", cause);
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

    private static String runCommand(List<String> command, Duration timeout) throws Exception {
        Process process = new ProcessBuilder(command).start();
        boolean finished = process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS);
        if (!finished) {
            process.destroyForcibly();
            process.waitFor();
            throw new TimeoutException("ffprobe timed out");
        }
        byte[] stdout = process.getInputStream().readAllBytes();
        byte[] stderr = process.getErrorStream().readAllBytes();
        if (process.exitValue() != 0) {
            throw new IOException("ffprobe failed: "
                    + new String(stderr, java.nio.charset.StandardCharsets.UTF_8));
        }
        return new String(stdout, java.nio.charset.StandardCharsets.UTF_8);
    }

    @FunctionalInterface
    interface ExecutableFinder {
        String find(String command);
    }

    @FunctionalInterface
    interface CommandRunner {
        String run(List<String> command, Duration timeout) throws Exception;
    }
}
