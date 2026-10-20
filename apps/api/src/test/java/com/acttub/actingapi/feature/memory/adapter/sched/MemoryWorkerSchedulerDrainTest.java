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
import com.acttub.actingapi.feature.memory.app.MemoryUpdateWorker;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

/** 한 번의 폴이 두 큐를 어떤 순서로 비우는지, 풀이 바쁘면 건너뛰는지 (practice.memory 「입력·출력」). */
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
    void pollDrainsTheLegacyQueueThenSweepsIdleRoundsThenDrainsTheNewQueue() {
        MemoryWorkerScheduler scheduler = scheduler(legacyWorker(true, true, false), actorWorker(true, false));
        when(executor.getActiveCount()).thenReturn(1, 0);

        scheduler.poll();
        assertThat(calls).isEmpty();

        scheduler.poll();
        assertThat(calls).containsExactly("legacy", "legacy", "legacy", "sweep", "actor", "actor");
    }

    @Test
    void withOnlyTheNewWorkerThePollSweepsAndDrainsIt() {
        when(executor.getActiveCount()).thenReturn(0);

        scheduler(null, actorWorker(false)).poll();
        scheduler(null, null).poll();

        assertThat(calls).containsExactly("sweep", "actor");
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

    private MemoryUpdateWorker legacyWorker(Boolean... results) {
        Deque<Boolean> queue = new ArrayDeque<>(List.of(results));
        MemoryUpdateWorker worker = mock(MemoryUpdateWorker.class);
        when(worker.runOnce()).thenAnswer(invocation -> {
            calls.add("legacy");
            return queue.removeFirst();
        });
        return worker;
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
    private MemoryWorkerScheduler scheduler(MemoryUpdateWorker legacy, ActorMemoryUpdateWorker actor) {
        ObjectProvider<MemoryUpdateWorker> legacyProvider = mock(ObjectProvider.class);
        when(legacyProvider.getIfAvailable()).thenReturn(legacy);
        ObjectProvider<ActorMemoryUpdateWorker> actorProvider = mock(ObjectProvider.class);
        when(actorProvider.getIfAvailable()).thenReturn(actor);
        return new MemoryWorkerScheduler(legacyProvider, actorProvider, executor, new RecordingFailureReporter());
    }
}
