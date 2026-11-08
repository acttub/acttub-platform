package com.acttub.actingapi.feature.challenge.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.UUID;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.junit.jupiter.api.Test;

/** 얼굴 여부 채우기의 갈래 — 꺼지면 아무것도 하지 않고, 실패한 참여작은 건너뛴다 (SOMA-1066). */
class EntryFaceBackfillTest {
    private final EntryModerationRepository moderations = mock(EntryModerationRepository.class);
    private final EntryModerationModel model = mock(EntryModerationModel.class);
    private final FailureReporter failures = mock(FailureReporter.class);
    private final AiReportRepository.Video video = new AiReportRepository.Video("videos/u/r.mp4", "video/mp4", 30_000);

    @Test void doesNothingWhenTheFlagIsOff() {
        when(model.available()).thenReturn(true);
        assertThat(new EntryFaceBackfill(moderations, model, failures, false).runOnce()).isZero();
        verifyNoInteractions(moderations);
        verify(model, never()).judge(any(), any());
    }

    @Test void doesNothingWithoutAModel() {
        when(model.available()).thenReturn(false);
        assertThat(new EntryFaceBackfill(moderations, model, failures, true).runOnce()).isZero();
        verifyNoInteractions(moderations);
    }

    @Test void asksOnlyForTheFaceAndSkipsAFailedEntry() {
        var seen = new EntryModerationRepository.FaceJob(UUID.randomUUID(), video);
        var broken = new EntryModerationRepository.FaceJob(UUID.randomUUID(), video);
        when(model.available()).thenReturn(true);
        when(moderations.claimFaces(EntryFaceBackfill.BATCH, EntryFaceBackfill.MAX_ATTEMPTS)).thenReturn(List.of(broken, seen));
        when(model.judge(eq(video), eq(EntryModerationPrompt.faceOnly())))
                .thenReturn(new EntryModerationModel.Output("모르겠어요", "m"))
                .thenReturn(new EntryModerationModel.Output("{\"face\":true}", "m"));
        assertThat(new EntryFaceBackfill(moderations, model, failures, true).runOnce()).isEqualTo(2);
        verify(failures).report(any(IllegalArgumentException.class), any(FailureContext.class));
        verify(moderations, never()).faceSeen(eq(broken.entryId()), anyBoolean());
        verify(moderations).faceSeen(seen.entryId(), true);
        verify(moderations, never()).claim(anyInt(), any());
    }
}
