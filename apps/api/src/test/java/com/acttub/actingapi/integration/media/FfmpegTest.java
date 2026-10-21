package com.acttub.actingapi.integration.media;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.stream.Stream;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** ffmpeg 프로세스 실행기와 출력 파일 만들기의 실패 처리 — 실제 프로세스(sh)로 본다. */
class FfmpegTest {
    @TempDir
    Path directory;

    @Test
    void processThatExitsWithAnErrorStatusFails() {
        assertThatThrownBy(() -> Ffmpeg.process("poster").run(List.of("sh", "-c", "exit 3"), Duration.ofSeconds(10)))
                .isInstanceOf(IOException.class)
                .hasMessage("ffmpeg exited with status 3");
    }

    @Test
    void processThatRunsPastTheTimeoutIsStoppedAndFails() {
        long started = System.nanoTime();

        assertThatThrownBy(() -> Ffmpeg.process("poster").run(List.of("sleep", "5"), Duration.ofMillis(100)))
                .isInstanceOf(IOException.class)
                .hasMessage("ffmpeg poster timed out");
        assertThat(Duration.ofNanos(System.nanoTime() - started)).isLessThan(Duration.ofSeconds(4));
    }

    @Test
    void processThatSucceedsReturnsNormally() throws Exception {
        Path marker = directory.resolve("ran");

        Ffmpeg.process("poster").run(List.of("sh", "-c", "echo ok > \"$0\"", marker.toString()), Duration.ofSeconds(10));

        assertThat(Files.readString(marker).strip()).isEqualTo("ok");
    }

    @Test
    void interruptedRunRemovesThePartialOutputAndKeepsTheInterruptFlag() throws Exception {
        Path source = Files.createFile(directory.resolve("take.mp4"));
        InterruptedException interrupted = new InterruptedException("stop");
        try {
            assertThatThrownBy(() -> Ffmpeg.produce((command, timeout) -> {
                Files.writeString(Path.of(command.getLast()), "partial");
                throw interrupted;
            }, Duration.ofSeconds(1), source, "poster-", ".jpg", output -> List.of("ffmpeg", output.toString()),
                    "empty poster")).isSameAs(interrupted);
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
        } finally {
            Thread.interrupted();
        }
        try (Stream<Path> files = Files.list(directory)) {
            assertThat(files.map(path -> path.getFileName().toString())).containsExactly("take.mp4");
        }
    }
}
