package com.acttub.actingapi.integration.media;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;

/** 정확한 원본 시각으로 청크를 자른다. 쉘 문자열/사용자 파일명 실행을 사용하지 않는다. */
public class VideoRecordChunks {
    public Path extract(Path source, long startMs, long endMs) {
        Path output = null;
        try {
            output = Files.createTempFile(source.toAbsolutePath().getParent(), "acttub-record-", ".mp4");
            Path target = output;
            FfmpegLock.run(() -> {
                run(List.of("ffmpeg", "-y", "-threads", "1", "-i", source.toString(),
                        "-ss", seconds(startMs), "-t", seconds(endMs - startMs),
                        "-map", "0:v:0", "-map", "0:a:0?",
                        "-vf", "scale=w=768:h=768:force_original_aspect_ratio=decrease:force_divisible_by=2",
                        "-c:v", "libx264", "-preset", "ultrafast", "-crf", "24", "-pix_fmt", "yuv420p",
                        "-c:a", "aac", "-b:a", "96k", "-threads", "1", target.toString()), Duration.ofMinutes(3));
                return null;
            });
            if (Files.size(output) == 0) {
                throw new IOException("empty video chunk");
            }
            return output;
        } catch (Exception failure) {
            if (failure instanceof InterruptedException) {
                Thread.currentThread().interrupt();
            }
            if (output != null) {
                try {
                    Files.deleteIfExists(output);
                } catch (IOException cleanup) {
                    failure.addSuppressed(cleanup);
                }
            }
            throw new IllegalStateException("video chunk extraction failed", failure);
        }
    }

    public boolean hasAudio(Path source) {
        Process process = null;
        try {
            process = new ProcessBuilder("ffprobe", "-v", "error", "-select_streams", "a",
                    "-show_entries", "stream=index", "-of", "csv=p=0", source.toString())
                    .redirectError(ProcessBuilder.Redirect.DISCARD).start();
            if (!process.waitFor(20, TimeUnit.SECONDS) || process.exitValue() != 0) {
                throw new IOException("audio track probe failed");
            }
            return !new String(process.getInputStream().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8).isBlank();
        } catch (IOException failure) {
            throw new IllegalStateException("audio track probe failed", failure);
        } catch (InterruptedException failure) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("audio track probe interrupted", failure);
        } finally {
            if (process != null && process.isAlive()) {
                process.destroyForcibly();
            }
        }
    }

    private static String seconds(long ms) {
        return String.format(Locale.ROOT, "%.3f", ms / 1000.0);
    }

    private static void run(List<String> command, Duration timeout) throws IOException, InterruptedException {
        Process process = new ProcessBuilder(command).redirectOutput(ProcessBuilder.Redirect.DISCARD)
                .redirectError(ProcessBuilder.Redirect.DISCARD).start();
        try {
            if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS) || process.exitValue() != 0) {
                throw new IOException("video chunk command failed");
            }
        } finally {
            if (process.isAlive()) {
                process.destroyForcibly();
                process.waitFor();
            }
        }
    }
}
