package com.acttub.actingapi.feature.memory.adapter.db;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.feature.memory.app.ActorMemoryUpdates;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

/** 대화가 닫힐 때의 기억 예약 실패는 대화를 되돌리지 않고 보고만 한다 (practice.memory). */
class ActorMemoryUpdateSchedulingTest {
    private static final UUID USER = UUID.fromString("00000000-0000-0000-0000-000000000001");
    private static final UUID PRACTICE = UUID.fromString("00000000-0000-0000-0000-000000000002");

    @Test
    void failingAvoidStillSchedulesAndAFailingScheduleIsReported() {
        List<String> steps = new ArrayList<>();
        ActorMemoryUpdates updates = mock(ActorMemoryUpdates.class);
        when(updates.appendAvoid(any(), any(), any())).thenAnswer(invocation -> {
            steps.add("avoid");
            throw new IllegalStateException("avoid failed");
        });
        when(updates.schedule(any(), any(), any())).thenAnswer(invocation -> {
            steps.add("schedule " + invocation.getArgument(1));
            throw new IllegalStateException("schedule failed");
        });
        RecordingFailureReporter reporter = new RecordingFailureReporter();

        new ActorMemoryUpdateScheduling(updates, Clock.fixed(Instant.EPOCH, ZoneOffset.UTC), reporter)
                .onConversationClosed(USER, PRACTICE);

        assertThat(steps).containsExactly("avoid", "schedule " + PRACTICE);
        assertThat(reporter.contexts()).containsExactly(
                "ActorMemoryUpdateScheduling.appendAvoid operation_id=" + PRACTICE,
                "ActorMemoryUpdateScheduling.schedule operation_id=" + PRACTICE);
    }
}
