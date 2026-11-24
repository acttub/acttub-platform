package com.acttub.actingapi.feature.memory.adapter.sched;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.List;

import com.acttub.actingapi.feature.memory.app.ActorMemoryUpdateWorker;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/** 한 번의 폴이 말 끊긴 회차를 본 뒤 큐를 비우는지, 풀이 바쁘면 건너뛰는지 (practice.memory 「입력·출력」). */
class MemoryWorkerSchedulerDrainTest {
    private final List<String> calls = new ArrayList<>();
    private final ThreadPoolTaskExecutor executor = mock(ThreadPoolTaskExecutor.class);

    MemoryWorkerSchedulerDrainTest() {
        doAnswer(invocation -> {
            invocation.getArgument(0, Runnable.class).run();
            return null;
        }).when(executor).execute(any(Runnable.class));
    }

    @Test
    void pollSweepsIdleRoundsThenDrainsTheQueueAndSkipsWhileBusy() {
        MemoryWorkerScheduler scheduler = scheduler(actorWorker(true, false));
        when(executor.getActiveCount()).thenReturn(1, 0);

        scheduler.poll();
        assertThat(calls).isEmpty();

        scheduler.poll();
        assertThat(calls).containsExactly("sweep", "actor", "actor");
    }

    @Test
    void withoutAWorkerThePollDoesNothing() {
        when(executor.getActiveCount()).thenReturn(0);

        scheduler(null).poll();

        assertThat(calls).isEmpty();
    }

    @Test
    void pollIntervalIsInMillisecondsAndAtLeastOne() {
        assertThat(MemoryWorkerScheduler.memoryWorkerPollIntervalMillis(2.5)).isEqualTo(2_500L);
        assertThat(MemoryWorkerScheduler.memoryWorkerPollIntervalMillis(0.0001)).isEqualTo(1L);
        assertThatThrownBy(() -> MemoryWorkerScheduler.memoryWorkerPollIntervalMillis(0))
                .hasMessage("memory worker settings must be positive");
        assertThatThrownBy(() -> MemoryWorkerScheduler.memoryWorkerPollIntervalMillis(Double.NaN))
                .hasMessage("memory worker settings must be positive");
    }

    private ActorMemoryUpdateWorker actorWorker(Boolean... results) {
        Deque<Boolean> queue = new ArrayDeque<>(List.of(results));
        ActorMemoryUpdateWorker worker = mock(ActorMemoryUpdateWorker.class);
        when(worker.sweepIdle()).thenAnswer(invocation -> {
            calls.add("sweep");
            return 0;
        });
        when(worker.runOnce()).thenAnswer(invocation -> {
            calls.add("actor");
            return queue.removeFirst();
        });
        return worker;
    }

    @SuppressWarnings("unchecked")
    private MemoryWorkerScheduler scheduler(ActorMemoryUpdateWorker actor) {
        ObjectProvider<ActorMemoryUpdateWorker> actorProvider = mock(ObjectProvider.class);
        when(actorProvider.getIfAvailable()).thenReturn(actor);
        return new MemoryWorkerScheduler(actorProvider, executor, new RecordingFailureReporter());
    }
}
