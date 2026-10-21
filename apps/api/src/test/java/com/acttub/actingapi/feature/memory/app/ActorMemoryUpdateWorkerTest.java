package com.acttub.actingapi.feature.memory.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.platform.observability.LlmTokens;
import com.acttub.actingapi.support.MutableClock;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.support.RecordingLlmTelemetry;
import org.junit.jupiter.api.Test;

/** 0.1.0 기억 갱신 워커가 실패를 어떻게 넘기는지 (practice.memory 「예외」, CONTRACT §5-7). */
class ActorMemoryUpdateWorkerTest {
    private static final Instant NOW = Instant.parse("2026-10-20T03:00:00Z");
    private static final UUID JOB = UUID.fromString("00000000-0000-0000-0000-00000000000a");
    private static final UUID USER = UUID.fromString("00000000-0000-0000-0000-00000000000b");
    private static final UUID PRACTICE = UUID.fromString("00000000-0000-0000-0000-00000000000c");

    private final FakeUpdates updates = new FakeUpdates();
    private final RecordingFailureReporter reporter = new RecordingFailureReporter();
    private final RecordingLlmTelemetry telemetry = new RecordingLlmTelemetry();
    private final List<String> prompts = new ArrayList<>();
    private String generated = "{\"goal\":\"문 앞에서 멈추지 않기\"}";

    private ActorMemoryUpdateWorker worker(MutableClock clock) {
        return new ActorMemoryUpdateWorker(updates, new MemoryExtractor(reporter), (system, user) -> {
            prompts.add(user);
            return new GeneratedText(generated, null, "test-model");
        }, clock, reporter, telemetry);
    }

    private ActorMemoryUpdateWorker worker() {
        return worker(new MutableClock(NOW));
    }

    @Test
    void idleSweepRunsAtMostEveryTenMinutesAndOneFailingRoundDoesNotStopTheOthers() {
        UUID broken = UUID.randomUUID();
        updates.idle.add(new ActorMemoryUpdates.Idle(USER, broken));
        updates.idle.add(new ActorMemoryUpdates.Idle(USER, PRACTICE));
        updates.failAvoidFor = broken;
        MutableClock clock = new MutableClock(NOW);
        ActorMemoryUpdateWorker worker = worker(clock);

        int first = worker.sweepIdle();
        clock.advance(Duration.ofMinutes(9));
        int tooSoon = worker.sweepIdle();
        clock.advance(Duration.ofMinutes(1));
        int afterInterval = worker.sweepIdle();

        assertThat(first).isEqualTo(2);
        assertThat(tooSoon).isZero();
        assertThat(afterInterval).isEqualTo(2);
        assertThat(updates.scheduled).containsExactly(PRACTICE, PRACTICE);
        assertThat(reporter.contexts()).containsExactly(
                "ActorMemoryUpdateWorker.sweepIdle operation_id=" + broken,
                "ActorMemoryUpdateWorker.sweepIdle operation_id=" + broken);
    }

    @Test
    void jobWhosePracticeIsGoneCompletesWithNothingWithoutCallingTheModel() {
        updates.claimable = true;

        boolean ran = worker().runOnce(NOW);

        assertThat(ran).isTrue();
        assertThat(updates.completed).containsExactly(Map.of());
        assertThat(prompts).isEmpty();
        assertThat(worker().runOnce(NOW)).isFalse();
    }

    @Test
    void extractionWithoutUsageIsRecordedWithUnknownTokens() {
        updates.claimable = true;
        updates.material = material();

        worker().runOnce(NOW);

        assertThat(updates.completed).containsExactly(Map.of("goal", "문 앞에서 멈추지 않기"));
        assertThat(telemetry.calls()).singleElement().satisfies(call -> {
            assertThat(call.tokens()).isEqualTo(LlmTokens.unknown());
            assertThat(call.model()).isEqualTo("test-model");
            assertThat(call.metadata()).containsEntry("operation_id", JOB.toString());
        });
    }

    @Test
    void lostLeaseOnCompletionIsReportedAndNotReleased() {
        updates.claimable = true;
        updates.material = material();
        updates.completeFailure = new LeaseOwnershipException("lease lost");

        worker().runOnce(NOW);

        assertThat(updates.released).isEmpty();
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).hasMessage("lease lost");
            assertThat(report.context()).isEqualTo("ActorMemoryUpdateWorker.complete operation_id=" + JOB);
        });
    }

    @Test
    void failedUpdateIsReleasedAndALeaseLostWhileReleasingIsReportedToo() {
        updates.claimable = true;
        updates.material = material();
        updates.completeFailure = new IllegalStateException("db down");
        updates.releaseFailure = new LeaseOwnershipException("lease lost while failing");

        worker().runOnce(NOW);

        assertThat(updates.released).containsExactly("memory_update_failed");
        assertThat(reporter.contexts()).containsExactly(
                "ActorMemoryUpdateWorker.update operation_id=" + JOB,
                "ActorMemoryUpdateWorker.release operation_id=" + JOB);
    }

    private static MemoryUpdateMaterial material() {
        return new MemoryUpdateMaterial(USER, PRACTICE, "목표", "분석", "캐릭터 분석", null,
                List.of(), List.of("문이 무거워요"), List.of());
    }

    private static final class FakeUpdates implements ActorMemoryUpdates {
        final List<Idle> idle = new ArrayList<>();
        final List<UUID> scheduled = new ArrayList<>();
        final List<Map<String, String>> completed = new ArrayList<>();
        final List<String> released = new ArrayList<>();
        UUID failAvoidFor;
        boolean claimable;
        MemoryUpdateMaterial material;
        RuntimeException completeFailure;
        RuntimeException releaseFailure;

        @Override
        public boolean schedule(UUID userId, UUID practiceId, Instant now) {
            scheduled.add(practiceId);
            return true;
        }

        @Override
        public boolean appendAvoid(UUID userId, UUID practiceId, Instant now) {
            if (practiceId.equals(failAvoidFor)) {
                throw new IllegalStateException("avoid failed");
            }
            return false;
        }

        @Override
        public List<Idle> idle(Instant now) {
            return List.copyOf(idle);
        }

        @Override
        public Claimed claim(UUID leaseToken, Duration lease, Instant now) {
            if (!claimable) {
                return null;
            }
            claimable = false;
            return new Claimed(JOB, USER, PRACTICE, 0);
        }

        @Override
        public MemoryUpdateMaterial material(UUID practiceId) {
            return material;
        }

        @Override
        public Map<String, String> current(UUID userId) {
            return Map.of();
        }

        @Override
        public List<String> complete(Claimed claimed, UUID leaseToken, Map<String, String> updates, Instant now) {
            if (completeFailure != null) {
                throw completeFailure;
            }
            completed.add(new LinkedHashMap<>(updates));
            return List.copyOf(updates.keySet());
        }

        @Override
        public void release(UUID jobId, UUID leaseToken, String reason, Instant now) {
            released.add(reason);
            if (releaseFailure != null) {
                throw releaseFailure;
            }
        }
    }
}
