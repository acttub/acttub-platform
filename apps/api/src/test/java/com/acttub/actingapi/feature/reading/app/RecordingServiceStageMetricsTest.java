package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.RecordingRepository.Precheck;
import com.acttub.actingapi.feature.reading.app.RecordingRepository.PrecheckOutcome;
import com.acttub.actingapi.feature.reading.app.RecordingRepository.StoreOutcome;
import com.acttub.actingapi.feature.reading.app.RecordingRepository.Stored;
import com.acttub.actingapi.feature.reading.app.SessionViews.RecordingView;
import com.acttub.actingapi.integration.media.AudioTranscoder;
import io.micrometer.core.instrument.Timer;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** 녹음 올리기의 단계별 시간: 지난 단계만 한 건씩 남고, 실패한 단계도 시간은 남기며 응답·예외는 그대로다. */
class RecordingServiceStageMetricsTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-11-24T09:00:00Z"), ZoneOffset.UTC);
    private static final RetranscribeSettings ON =
            new RetranscribeSettings(true, -30, 400, 60_000, 1_500, Duration.ofMinutes(5), 2);

    @TempDir
    Path temporary;

    private final SimpleMeterRegistry registry = new SimpleMeterRegistry();
    private final RecordingRepository recordings = mock(RecordingRepository.class);
    private final RecordingStorage storage = mock(RecordingStorage.class);
    private final ReadingRecordingCleanup cleanup = mock(ReadingRecordingCleanup.class);
    private final RetranscribeRepository queue = mock(RetranscribeRepository.class);
    // ffmpeg 대신 출력 자리에 2,000바이트를 쓴다.
    private final AudioTranscoder transcoder = new AudioTranscoder(
            (command, timeout) -> Files.write(Path.of(command.getLast()), new byte[2_000]));
    private final RecordingService service = new RecordingService(recordings, storage, transcoder,
            new RecordingPlayback(storage, CLOCK), cleanup, CLOCK, queue, ON, new RecordingUploadMetrics(registry));

    @Test
    void seriesAreFixedBeforeTheFirstUpload() {
        List<String> series = registry.find("acttub.reading.recording.upload").timers().stream()
                .map(timer -> timer.getId().getTag("stage") + ":" + timer.getId().getTag("conversion")).sorted().toList();
        assertThat(series).hasSize(17).contains("transcode:transcoded").doesNotContain("transcode:skipped");
        assertThat(registry.find("acttub.reading.recording.upload").timers())
                .allSatisfy(timer -> assertThat(timer.getId().getTags()).hasSize(2));
    }

    @Test
    void m4aSkipsTranscodeAndRecordsEachStageOnce() throws Exception {
        stored(StoreOutcome.CREATED, List.of(), "none");
        assertThat(service.upload(UUID.randomUUID(), false, UUID.randomUUID(), upload("audio/mp4", "none")).created()).isTrue();
        assertThat(recorded()).containsExactlyInAnyOrderEntriesOf(Map.of(
                "precheck:skipped", 1L, "storage:skipped", 1L, "store:skipped", 1L));
        verify(cleanup).attempt(List.of());
    }

    @Test
    void wavReplacementRecordsTranscodeCleanupAndRetranscribe() throws Exception {
        List<UUID> cleanupIds = List.of(UUID.randomUUID());
        stored(StoreOutcome.REPLACED, cleanupIds, "stt");
        assertThat(service.upload(UUID.randomUUID(), false, UUID.randomUUID(), upload("audio/wav", "stt")).created()).isTrue();
        assertThat(recorded()).containsExactlyInAnyOrderEntriesOf(Map.of(
                "precheck:transcoded", 1L, "transcode:transcoded", 1L, "storage:transcoded", 1L,
                "store:transcoded", 1L, "cleanup:transcoded", 1L, "retranscribe:transcoded", 1L));
        verify(cleanup).attempt(cleanupIds);
    }

    @Test
    void replayStopsAfterPrecheck() throws Exception {
        RecordingView current = view("none");
        when(recordings.precheck(any(), any(), any(), any(), anyInt()))
                .thenReturn(new Precheck(PrecheckOutcome.REPLAYED, current));
        assertThat(service.upload(UUID.randomUUID(), false, UUID.randomUUID(), upload("audio/mp4", "none")).created()).isFalse();
        assertThat(recorded()).containsExactlyInAnyOrderEntriesOf(Map.of("precheck:skipped", 1L));
    }

    @Test
    void failedStageStillRecordsItsTimeAndKeepsTheFailure() throws Exception {
        when(recordings.precheck(any(), any(), any(), any(), anyInt())).thenReturn(new Precheck(PrecheckOutcome.OK, null));
        IllegalStateException unavailable = new IllegalStateException("storage down");
        doThrow(unavailable).when(storage).upload(any(), any(), any());
        assertThatThrownBy(() -> service.upload(UUID.randomUUID(), false, UUID.randomUUID(), upload("audio/mp4", "none")))
                .isSameAs(unavailable);
        assertThat(recorded()).containsExactlyInAnyOrderEntriesOf(Map.of("precheck:skipped", 1L, "storage:skipped", 1L));
    }

    private Map<String, Long> recorded() {
        Map<String, Long> counts = new TreeMap<>();
        for (Timer timer : registry.find("acttub.reading.recording.upload").timers()) {
            if (timer.count() > 0) {
                counts.put(timer.getId().getTag("stage") + ":" + timer.getId().getTag("conversion"), timer.count());
            }
        }
        return counts;
    }

    private void stored(StoreOutcome outcome, List<UUID> cleanupIds, String source) {
        when(recordings.precheck(any(), any(), any(), any(), anyInt())).thenReturn(new Precheck(PrecheckOutcome.OK, null));
        when(recordings.store(any(), any(), any(), anyLong(), any())).thenReturn(new Stored(outcome, view(source), cleanupIds));
    }

    private static RecordingView view(String source) {
        return new RecordingView(UUID.randomUUID(), UUID.randomUUID(), 1, 1500, "audio/mp4", 2_000, null, source, null,
                "reading/key.m4a", null, null);
    }

    private RecordingService.Upload upload(String contentType, String source) throws Exception {
        Path file = Files.write(temporary.resolve(UUID.randomUUID() + ".upload"), new byte[2_000]);
        return new RecordingService.Upload(UUID.randomUUID(), UUID.randomUUID(), 1, contentType, file, 2_000, 1500, null,
                source);
    }
}
