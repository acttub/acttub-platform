package com.acttub.actingapi.analysis;

import java.io.File;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import com.acttub.actingapi.media.FfmpegLock;

/** {@code acting_llm.media.extract_audio}의 활성 경로만 옮긴다. */
public final class FfmpegAudioExtractor implements AudioExtractor {
    static final Duration TIMEOUT = Duration.ofSeconds(120);
    private final ExecutableFinder executableFinder;
    private final CommandRunner commandRunner;

    public FfmpegAudioExtractor() {
        this(FfmpegAudioExtractor::findExecutable, FfmpegAudioExtractor::run);
    }

    FfmpegAudioExtractor(ExecutableFinder executableFinder, CommandRunner commandRunner) {
        this.executableFinder = executableFinder;
        this.commandRunner = commandRunner;
    }

    @Override
    public Path extract(Path videoPath, long maximumDurationMs) {
        Path directory = null;
        try {
            String ffmpeg = executableFinder.find("ffmpeg");
            if (ffmpeg == null) {
                throw new IOException("ffmpeg not found");
            }
            directory = Files.createTempDirectory("acttub-transcription-");
            Path audio = directory.resolve("audio.mp3");
            List<String> command = List.of(
                    ffmpeg,
                    "-hide_banner",
                    "-loglevel", "error",
                    "-threads", "1",
                    "-i", videoPath.toString(),
                    "-t", String.format(java.util.Locale.ROOT, "%.3f", maximumDurationMs / 1000d),
                    "-vn",
                    "-codec:a", "libmp3lame",
                    "-q:a", "4",
                    "-y",
                    audio.toString());
            FfmpegLock.run(() -> {
                commandRunner.run(command, TIMEOUT);
                return null;
            });
            return audio;
        } catch (Exception exception) {
            deleteTree(directory);
            throw new IllegalStateException("audio extraction failed", exception);
        }
    }

    private static void run(List<String> command, Duration timeout) throws Exception {
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

    static void deleteTree(Path directory) {
        if (directory == null || !Files.exists(directory)) {
            return;
        }
        try (var paths = Files.walk(directory)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try {
                    Files.deleteIfExists(path);
                } catch (IOException ignored) {
                    // 전사 정리는 분석 성공 여부를 바꾸지 않는다.
                }
            });
        } catch (IOException ignored) {
            // Python shutil.rmtree(ignore_errors=True)와 같다.
        }
    }

    @FunctionalInterface
    interface ExecutableFinder {
        String find(String executable);
    }

    @FunctionalInterface
    interface CommandRunner {
        void run(List<String> command, Duration timeout) throws Exception;
    }
}
