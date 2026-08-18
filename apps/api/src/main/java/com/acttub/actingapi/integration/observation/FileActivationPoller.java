package com.acttub.actingapi.integration.observation;

import java.time.Duration;
import java.util.function.Function;
import java.util.function.LongSupplier;

final class FileActivationPoller {

    private FileActivationPoller() {
    }

    static GeminiFile waitUntilActive(
            GeminiFile initial,
            Function<String, GeminiFile> refresh,
            Duration timeout,
            Duration pollInterval,
            LongSupplier nanoTime,
            Sleeper sleeper) {
        long deadline = nanoTime.getAsLong() + timeout.toNanos();
        GeminiFile current = initial;
        while ("PROCESSING".equals(current.state())) {
            if (nanoTime.getAsLong() >= deadline) {
                throw new FileActiveTimeout(
                        "file " + current.name() + " not ACTIVE within "
                                + timeout.toSeconds() + "s");
            }
            sleeper.sleep(pollInterval);
            current = refresh.apply(current.name());
        }
        if (!"ACTIVE".equals(current.state())) {
            throw new FileActiveTimeout(
                    "file " + current.name() + " state=" + current.state());
        }
        return current;
    }

    @FunctionalInterface
    interface Sleeper {
        void sleep(Duration duration);

        static Sleeper real() {
            return duration -> {
                try {
                    Thread.sleep(duration);
                } catch (InterruptedException exc) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("interrupted while polling", exc);
                }
            };
        }
    }
}
