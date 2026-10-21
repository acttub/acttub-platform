package com.acttub.actingapi.feature.reading.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.acttub.actingapi.feature.reading.app.PronunciationWorker;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

/** 발음 보고서 예약: 쌓인 것을 다 비우고, 실패는 알린 뒤 다음 주기를 기다린다(SOMA-606). */
class PronunciationWorkerSchedulerTest {
    final PronunciationWorker worker = mock(PronunciationWorker.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();

    @Test
    void 집을_것이_없을_때까지_돈다() {
        when(worker.runOnce()).thenReturn(true, true, false);
        new PronunciationWorkerScheduler(worker, failures).run();
        verify(worker, times(3)).runOnce();
        assertThat(failures.reports()).isEmpty();
    }

    @Test
    void 실패는_알리고_멈춘다() {
        when(worker.runOnce()).thenThrow(new IllegalStateException("scorer down"));
        new PronunciationWorkerScheduler(worker, failures).run();
        verify(worker, times(1)).runOnce();
        assertThat(failures.contexts()).containsExactly("PronunciationWorkerScheduler.run");
    }
}
