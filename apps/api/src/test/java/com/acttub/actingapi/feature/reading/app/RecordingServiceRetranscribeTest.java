package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.reading.app.RecordingRepository.Precheck;
import com.acttub.actingapi.feature.reading.app.RecordingRepository.PrecheckOutcome;
import com.acttub.actingapi.feature.reading.app.RecordingRepository.StoreOutcome;
import com.acttub.actingapi.feature.reading.app.RecordingRepository.Stored;
import com.acttub.actingapi.feature.reading.app.SessionViews.RecordingView;
import com.acttub.actingapi.integration.media.AudioTranscoder;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** 녹음 저장 뒤 서버 다시 받아쓰기 줄 세우기: 기기 인식을 켰는데 글이 없을 때만, 실패해도 저장은 성공. */
class RecordingServiceRetranscribeTest {
    private static final Clock CLOCK = Clock.fixed(Instant.parse("2026-10-30T09:00:00Z"), ZoneOffset.UTC);
    private static final RetranscribeSettings ON = new RetranscribeSettings(true, -30, 400, 60_000, Duration.ofMinutes(5), 2);
    private static final RetranscribeSettings OFF = new RetranscribeSettings(false, -30, 400, 60_000, Duration.ofMinutes(5), 2);

    @TempDir
    Path temporary;

    private final RecordingRepository recordings = mock(RecordingRepository.class);
    private final RecordingStorage storage = mock(RecordingStorage.class);
    private final ReadingRecordingCleanup cleanup = mock(ReadingRecordingCleanup.class);
    private final RetranscribeRepository queue = mock(RetranscribeRepository.class);

    private RecordingService service(RetranscribeSettings settings) {
        return new RecordingService(recordings, storage, new AudioTranscoder(), new RecordingPlayback(storage, CLOCK), cleanup,
                CLOCK, queue, settings);
    }

    private RecordingView stored(StoreOutcome outcome, String transcript, String source) throws Exception {
        UUID id = UUID.randomUUID();
        RecordingView view = new RecordingView(id, UUID.randomUUID(), 1, 1500, "audio/mp4", 20_000, transcript, source, null,
                "reading/key.m4a", null, null);
        when(recordings.precheck(any(), any(), any(), any(), anyInt())).thenReturn(new Precheck(PrecheckOutcome.OK, null));
        when(recordings.store(any(), any(), any(), anyLong(), any())).thenReturn(new Stored(outcome, view, List.of()));
        return view;
    }

    private RecordingService.Upload upload(String transcript, String source) throws Exception {
        Path file = Files.write(temporary.resolve(UUID.randomUUID() + ".m4a"), new byte[2_000]);
        return new RecordingService.Upload(UUID.randomUUID(), UUID.randomUUID(), 1, "audio/mp4", file, 2_000, 1500, transcript,
                source);
    }

    @Test
    void emptySttTranscriptIsQueued() throws Exception {
        RecordingView view = stored(StoreOutcome.CREATED, null, "stt");
        assertThat(service(ON).upload(UUID.randomUUID(), false, UUID.randomUUID(), upload(null, "stt")).created()).isTrue();
        verify(queue).enqueue(eq(view.id()), eq("reading/key.m4a"), eq(CLOCK.instant()));
    }

    @Test
    void replacedRecordingIsQueuedAgain() throws Exception {
        RecordingView view = stored(StoreOutcome.REPLACED, " ", "stt");
        service(ON).upload(UUID.randomUUID(), false, UUID.randomUUID(), upload(" ", "stt"));
        verify(queue).enqueue(eq(view.id()), any(), any());
    }

    @Test
    void recognizedOrUnrecognizedOrDisabledIsNotQueued() throws Exception {
        stored(StoreOutcome.CREATED, "대사", "stt");
        service(ON).upload(UUID.randomUUID(), false, UUID.randomUUID(), upload("대사", "stt"));
        stored(StoreOutcome.CREATED, null, "none");
        service(ON).upload(UUID.randomUUID(), false, UUID.randomUUID(), upload(null, "none"));
        stored(StoreOutcome.CREATED, null, "stt");
        service(OFF).upload(UUID.randomUUID(), false, UUID.randomUUID(), upload(null, "stt"));
        stored(StoreOutcome.REPLAYED, null, "stt");
        service(ON).upload(UUID.randomUUID(), false, UUID.randomUUID(), upload(null, "stt"));
        verify(queue, never()).enqueue(any(), any(), any());
    }

    @Test
    void queueFailureDoesNotFailTheUpload() throws Exception {
        stored(StoreOutcome.CREATED, null, "stt");
        doThrow(new IllegalStateException("db down")).when(queue).enqueue(any(), any(), any());
        assertThat(service(ON).upload(UUID.randomUUID(), false, UUID.randomUUID(), upload(null, "stt")).created()).isTrue();
    }
}
