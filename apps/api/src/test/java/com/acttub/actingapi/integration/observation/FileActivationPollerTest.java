package com.acttub.actingapi.integration.observation;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

import org.junit.jupiter.api.Test;

class FileActivationPollerTest {
    private static final Duration TIMEOUT = Duration.ofSeconds(30);
    private static final Duration POLL = Duration.ofMillis(500);

    private static GeminiFile file(String state) {
        return new GeminiFile("files/take", "https://files.test/take", "video/mp4", state);
    }

    @Test
    void pollsWhileProcessingAndReturnsTheActiveFile() {
        Deque<GeminiFile> states = new ArrayDeque<>(List.of(file("PROCESSING"), file("ACTIVE")));
        List<Duration> sleeps = new ArrayList<>();

        GeminiFile active = FileActivationPoller.waitUntilActive(
                file("PROCESSING"), name -> states.removeFirst(), TIMEOUT, POLL, () -> 0L, sleeps::add);

        assertThat(active.state()).isEqualTo("ACTIVE");
        assertThat(sleeps).containsExactly(POLL, POLL);
    }

    @Test
    void fileThatEndsInAnotherStateIsNotActive() {
        assertThatThrownBy(() -> FileActivationPoller.waitUntilActive(
                file("PROCESSING"), name -> file("FAILED"), TIMEOUT, POLL, () -> 0L, duration -> { }))
                .isInstanceOf(FileActiveTimeout.class)
                .hasMessage("file files/take state=FAILED");
    }

    @Test
    void fileStillProcessingAtTheDeadlineTimesOut() {
        long[] now = {0};

        assertThatThrownBy(() -> FileActivationPoller.waitUntilActive(
                file("PROCESSING"), name -> file("PROCESSING"), TIMEOUT, POLL, () -> now[0],
                duration -> now[0] += duration.toNanos() * 100))
                .isInstanceOf(FileActiveTimeout.class)
                .hasMessage("file files/take not ACTIVE within 30s");
    }

    @Test
    void realSleeperSleepsAndTurnsAnInterruptIntoAFailure() {
        long started = System.nanoTime();
        FileActivationPoller.Sleeper.real().sleep(Duration.ofMillis(20));
        assertThat(System.nanoTime() - started).isGreaterThanOrEqualTo(Duration.ofMillis(20).toNanos());

        Thread.currentThread().interrupt();
        try {
            assertThatThrownBy(() -> FileActivationPoller.Sleeper.real().sleep(Duration.ofSeconds(5)))
                    .isInstanceOf(IllegalStateException.class)
                    .hasMessage("interrupted while polling");
            assertThat(Thread.currentThread().isInterrupted()).isTrue();
        } finally {
            Thread.interrupted();
        }
    }
}
