package com.acttub.actingapi.feature.challenge.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.UUID;
import com.acttub.actingapi.feature.challenge.app.EntryModerationVerdict.Decision;
import com.acttub.actingapi.feature.challenge.domain.ChallengeRules;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.junit.jupiter.api.Test;

/** 검사 워커의 갈래 — 판정은 붙이고, 실패는 상한까지 다시, 마지막 실패는 운영 확인으로 닫는다 (SOMA-907). */
class EntryModerationWorkerTest {
    private static final Instant NOW = Instant.parse("2026-10-27T09:00:00Z");
    private final EntryModerationRepository moderations = mock(EntryModerationRepository.class);
    private final EntryModerationModel model = mock(EntryModerationModel.class);
    private final FailureReporter failures = mock(FailureReporter.class);
    private final EntryModerationWorker worker =
            new EntryModerationWorker(moderations, model, failures, Clock.fixed(NOW, ZoneOffset.UTC));
    private final AiReportRepository.Video video = new AiReportRepository.Video("videos/u/r.mp4", "video/mp4", 30_000);

    private EntryModerationRepository.Job job(int attempts) {
        var job = new EntryModerationRepository.Job(UUID.randomUUID(), attempts, 1, video, "가지 마", "첫 참여");
        when(model.available()).thenReturn(true);
        when(moderations.claim(ChallengeRules.MODERATION_MAX_ATTEMPTS, NOW)).thenReturn(job);
        return job;
    }

    @Test void doesNothingWithoutAModel() {
        when(model.available()).thenReturn(false);
        assertThat(worker.runOnce()).isFalse();
        verify(moderations, never()).claim(anyInt(), any());
    }

    @Test void stopsWhenThereIsNoWork() {
        when(model.available()).thenReturn(true);
        assertThat(worker.runOnce()).isFalse();
    }

    @Test void attachesTheVerdictWithTheLineAndCaptionInTheInstruction() {
        var job = job(1);
        when(model.judge(eq(video), anyString())).thenAnswer(call -> {
            String instruction = call.getArgument(1);
            assertThat(instruction).contains("«가지 마»").contains("«첫 참여»");
            return new EntryModerationModel.Output("{\"verdict\":\"hide\",\"category\":\"sexual\",\"reason\":\"노출\"}", "m");
        });
        assertThat(worker.runOnce()).isTrue();
        verify(moderations).judged(job, new EntryModerationVerdict(Decision.HIDE, "sexual", "노출"), "m", NOW);
        verify(moderations, never()).fail(any(), any());
    }

    @Test void aFailureBeforeTheLastAttemptIsRetriedLater() {
        job(ChallengeRules.MODERATION_MAX_ATTEMPTS - 1);
        when(model.judge(eq(video), anyString())).thenThrow(new IllegalStateException("timeout"));
        assertThat(worker.runOnce()).isTrue();
        verify(failures).report(any(IllegalStateException.class), any(FailureContext.class));
        verify(moderations, never()).fail(any(), any());
    }

    @Test void anUnreadableOutputOnTheLastAttemptClosesForOpsReview() {
        var job = job(ChallengeRules.MODERATION_MAX_ATTEMPTS);
        when(model.judge(eq(video), anyString())).thenReturn(new EntryModerationModel.Output("모르겠어요", "m"));
        assertThat(worker.runOnce()).isTrue();
        verify(moderations, never()).judged(any(), any(), anyString(), any());
        verify(moderations).fail(job, NOW);
    }
}
