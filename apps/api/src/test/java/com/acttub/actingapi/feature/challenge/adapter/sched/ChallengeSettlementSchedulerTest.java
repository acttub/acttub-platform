package com.acttub.actingapi.feature.challenge.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.time.Instant;

import com.acttub.actingapi.feature.challenge.app.EntryRepository;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

/** 챌린지 정산 예약: 지금 시각으로 정산하고, 실패는 보고만 하고 다음 실행을 막지 않는다. */
class ChallengeSettlementSchedulerTest {
    final EntryRepository entries = mock(EntryRepository.class);
    final RecordingFailureReporter failures = new RecordingFailureReporter();
    final MutableClock clock = new MutableClock(Instant.parse("2026-10-20T03:00:00Z"));
    final ChallengeSettlementScheduler scheduler = new ChallengeSettlementScheduler(entries, clock, failures);

    @Test void settlesAtTheCurrentInstant() {
        scheduler.run();
        verify(entries).settle(Instant.parse("2026-10-20T03:00:00Z"));
        assertThat(failures.reports()).isEmpty();
    }

    @Test void aFailedSettlementIsReported() {
        doThrow(new IllegalStateException("lock timeout")).when(entries).settle(any());
        scheduler.run();
        assertThat(failures.contexts()).containsExactly("ChallengeSettlementScheduler.run");
    }
}
