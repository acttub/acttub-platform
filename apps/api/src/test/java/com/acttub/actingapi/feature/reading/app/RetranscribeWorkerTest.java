package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;

/** 리딩 녹음 서버 다시 받아쓰기 일꾼: 무음은 보내지 않고, 소리가 있으면 받아써 채우고, 한도·실패면 멈춘다. */
class RetranscribeWorkerTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-30T09:00:00Z"), ZoneOffset.UTC);
    private static final UUID RECORDING = UUID.randomUUID();
    private static final RetranscribeSettings ON = new RetranscribeSettings(true, -36, 400, 60_000, Duration.ofMinutes(5), 2);

    static final class FakeQueue implements RetranscribeRepository {
        Claimed next;
        long transcribed;
        final List<String> events = new ArrayList<>();
        String filled;
        Double peak;

        @Override
        public void enqueue(UUID recordingId, String objectKey, Instant now) {
            events.add("enqueue");
        }

        @Override
        public Claimed claimNext(UUID leaseToken, Duration lease, int maxAttempts, Instant now) {
            Claimed claimed = next;
            next = null;
            return claimed;
        }

        @Override
        public long transcribedSince(Instant since) {
            return transcribed;
        }

        @Override
        public void markTranscribing(UUID recordingId, UUID leaseToken, Instant now) {
            events.add("mark");
        }

        @Override
        public boolean fill(UUID recordingId, UUID leaseToken, String objectKey, String transcript, Double peakDb, Instant now) {
            events.add("fill");
            filled = transcript;
            peak = peakDb;
            return true;
        }

        @Override
        public void finish(UUID recordingId, UUID leaseToken, String status, Double peakDb, Instant now) {
            events.add(status);
            peak = peakDb;
        }

        @Override
        public void fail(UUID recordingId, UUID leaseToken, String failure, boolean retry, Instant now) {
            events.add(retry ? "retry:" + failure : "failed:" + failure);
        }

        @Override
        public void release(UUID recordingId, UUID leaseToken, Instant now) {
            events.add("release");
        }
    }

    static final class FakeAudio implements RetranscribeAudio {
        double peak = -12;
        String text = "대사 하나";
        RuntimeException failure;
        int transcribed;

        @Override
        public double peakDb(Path audio) {
            return peak;
        }

        @Override
        public String transcribe(Path audio) {
            transcribed += 1;
            if (failure != null) {
                throw failure;
            }
            return text;
        }
    }

    private final FakeQueue queue = new FakeQueue();
    private final FakeAudio audio = new FakeAudio();
    private final List<Path> downloaded = new ArrayList<>();
    private final PronunciationAudio storage = (key, destination) -> {
        downloaded.add(destination);
        try {
            Files.writeString(destination, "audio");
        } catch (IOException failure) {
            throw new UncheckedIOException(failure);
        }
    };

    private RetranscribeWorker worker(RetranscribeSettings settings) {
        return new RetranscribeWorker(queue, storage, audio, settings, CLOCK);
    }

    private static RetranscribeRepository.Claimed claimed(boolean current, Integer durationMs, int attempt) {
        return new RetranscribeRepository.Claimed(RECORDING, "rec/key", durationMs, attempt, current);
    }

    @Test
    void loudRecordingIsTranscribedAndFilled() {
        queue.next = claimed(true, 4_000, 1);
        assertThat(worker(ON).runOnce()).isTrue();
        assertThat(queue.events).containsExactly("mark", "fill");
        assertThat(queue.filled).isEqualTo("대사 하나");
        assertThat(queue.peak).isEqualTo(-12.0);
        assertThat(downloaded).hasSize(1);
        assertThat(downloaded.getFirst()).doesNotExist();
    }

    @Test
    void quietRecordingIsNotSentToTheModel() {
        queue.next = claimed(true, 4_000, 1);
        audio.peak = -45;
        assertThat(worker(ON).runOnce()).isTrue();
        assertThat(queue.events).containsExactly("silent");
        assertThat(audio.transcribed).isZero();
        assertThat(queue.peak).isEqualTo(-45.0);
    }

    @Test
    void digitalSilenceIsStoredWithoutAPeak() {
        queue.next = claimed(true, 4_000, 1);
        audio.peak = Double.NEGATIVE_INFINITY;
        assertThat(worker(ON).runOnce()).isTrue();
        assertThat(queue.events).containsExactly("silent");
        assertThat(queue.peak).isNull();
    }

    @Test
    void blankModelResultIsEmptyAndLeavesTheRecording() {
        queue.next = claimed(true, 4_000, 1);
        audio.text = "  ";
        assertThat(worker(ON).runOnce()).isTrue();
        assertThat(queue.events).containsExactly("mark", "empty");
    }

    @Test
    void replacedRecordingIsSkippedWithoutDownloading() {
        queue.next = claimed(false, 4_000, 1);
        assertThat(worker(ON).runOnce()).isTrue();
        assertThat(queue.events).containsExactly("stale");
        assertThat(downloaded).isEmpty();
    }

    @Test
    void longRecordingIsSkipped() {
        queue.next = claimed(true, 61_000, 1);
        assertThat(worker(ON).runOnce()).isTrue();
        assertThat(queue.events).containsExactly("too_long");
        assertThat(downloaded).isEmpty();
    }

    @Test
    void dailyLimitReleasesAndStops() {
        queue.next = claimed(true, 4_000, 1);
        queue.transcribed = 400;
        assertThat(worker(ON).runOnce()).isFalse();
        assertThat(queue.events).containsExactly("release");
        assertThat(downloaded).isEmpty();
    }

    @Test
    void failureRetriesOnceThenFailsAndStopsTheCycle() {
        audio.failure = new IllegalStateException("model down");
        queue.next = claimed(true, 4_000, 1);
        assertThat(worker(ON).runOnce()).isFalse();
        queue.next = claimed(true, 4_000, 2);
        assertThat(worker(ON).runOnce()).isFalse();
        assertThat(queue.events).containsExactly("mark", "retry:IllegalStateException", "mark", "failed:IllegalStateException");
    }

    @Test
    void disabledWorkerDoesNothing() {
        queue.next = claimed(true, 4_000, 1);
        assertThat(worker(new RetranscribeSettings(false, -36, 400, 60_000, Duration.ofMinutes(5), 2)).runOnce()).isFalse();
        assertThat(queue.events).isEmpty();
    }
}
