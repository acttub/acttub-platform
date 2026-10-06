package com.acttub.actingapi.feature.memory.app;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import com.acttub.actingapi.platform.observability.LlmTokens;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 0.1.0 회차가 끝난 뒤 배우 기억을 뒤에서 갱신한다 ({@code ai_jobs} 종류 {@code memory_update}, practice.memory).
 *
 * <p>대화 응답 안에서 처리하지 않는 이유는 속도다 — 그 화면은 이미 노트를 만드느라 느린데 모델 호출을 하나 더
 * 얹으면 배우가 그만큼 더 기다린다.
 *
 * <p><b>기억 갱신이 실패해도 연습은 정상이다.</b> 그래서 실패해도 회차 상태를 건드리지 않는다.
 *
 * <p>뽑는 규칙은 옛 워커와 <b>같은 {@link MemoryExtractor}</b> 다 — 근거는 배우 발화·받아쓰기·관찰뿐이고 개인
 * 심리를 판정하지 않는다. 갈리는 것은 어디서 집고(=ai_jobs) 어느 표에 쓰는가(=actor_memories)뿐이다.
 */
public class ActorMemoryUpdateWorker {
    static final Duration DEFAULT_LEASE = Duration.ofMinutes(5);
    private static final Logger LOG = LoggerFactory.getLogger(ActorMemoryUpdateWorker.class);

    private final ActorMemoryUpdates updates;
    private final MemoryExtractor extractor;
    private final TextGenerator generator;
    private final Clock clock;
    private final FailureReporter failureReporter;
    private final LlmTelemetry telemetry;

    public ActorMemoryUpdateWorker(
            ActorMemoryUpdates updates,
            MemoryExtractor extractor,
            TextGenerator generator,
            Clock clock,
            FailureReporter failureReporter,
            LlmTelemetry telemetry) {
        this.updates = updates;
        this.extractor = extractor;
        this.generator = generator;
        this.clock = clock;
        this.failureReporter = failureReporter;
        this.telemetry = telemetry;
    }

    public boolean runOnce() {
        return runOnce(clock.instant());
    }

    /** 말이 끊긴 열린 회차를 보는 간격. 큐를 비우는 폴(2초)마다 보지 않는다. */
    static final Duration IDLE_SWEEP_INTERVAL = Duration.ofMinutes(10);
    private volatile Instant lastIdleSweep = Instant.EPOCH;

    /**
     * 배우가 두 번 이상 답하고 떠난 열린 회차도 기억에 넣는다(SOMA-603) — 다시 말하지 않을 것을 덧붙이고, 갱신 차례면
     * 작업을 예약한다. 닫힌 회차는 대화가 닫힐 때 같은 일을 한다.
     *
     * @return 이번에 본 회차 수. 간격이 덜 찼으면 0
     */
    public int sweepIdle() {
        Instant now = clock.instant();
        if (Duration.between(lastIdleSweep, now).compareTo(IDLE_SWEEP_INTERVAL) < 0) {
            return 0;
        }
        lastIdleSweep = now;
        return sweepIdle(now);
    }

    /** 간격과 상관없이 지금 본다. */
    public int sweepIdle(Instant now) {
        List<ActorMemoryUpdates.Idle> idle = updates.idle(now);
        for (ActorMemoryUpdates.Idle round : idle) {
            try {
                updates.appendAvoid(round.userId(), round.practiceId(), now);
                updates.schedule(round.userId(), round.practiceId(), now);
            } catch (RuntimeException failure) {
                failureReporter.report(
                        failure, new FailureContext("ActorMemoryUpdateWorker.sweepIdle", round.practiceId()));
            }
        }
        return idle.size();
    }

    /** 큐에서 하나 집어 처리한다. 집을 게 없으면 거짓. */
    public boolean runOnce(Instant now) {
        UUID leaseToken = UUID.randomUUID();
        ActorMemoryUpdates.Claimed claimed = updates.claim(leaseToken, DEFAULT_LEASE, now);
        if (claimed == null) {
            return false;
        }
        try {
            MemoryUpdateMaterial material = updates.material(claimed.practiceId());
            updates.complete(claimed, leaseToken, extract(claimed, material), now);
        } catch (LeaseOwnershipException lost) {
            LOG.warn("기억 갱신 lease 를 잃었다: {}", claimed.jobId());
            failureReporter.report(
                    lost, new FailureContext("ActorMemoryUpdateWorker.complete", claimed.jobId()));
        } catch (RuntimeException failure) {
            LOG.warn("기억 갱신 실패: {}", claimed.jobId(), failure);
            failureReporter.report(
                    failure, new FailureContext("ActorMemoryUpdateWorker.update", claimed.jobId()));
            try {
                // 분석과 같은 규칙이다 — 바깥 실패는 재큐이고 시도를 소진하면 sweep 이 닫는다(CONTRACT §5-7).
                // 회차 자체는 건드리지 않는다: 기억은 있으면 좋은 것이지 없다고 연습이 망가질 것은 아니다.
                updates.release(claimed.jobId(), leaseToken, "memory_update_failed", now);
            } catch (LeaseOwnershipException lostWhileFailing) {
                LOG.warn("기억 갱신 실패 처리 중 lease 를 잃었다: {}", claimed.jobId());
                failureReporter.report(
                        lostWhileFailing,
                        new FailureContext("ActorMemoryUpdateWorker.release", claimed.jobId()));
            }
        }
        return true;
    }

    private Map<String, String> extract(ActorMemoryUpdates.Claimed claimed, MemoryUpdateMaterial material) {
        if (material == null) {
            LOG.info("기억 갱신 재료가 없다(회차가 지워졌거나 숨겨졌다): {}", claimed.jobId());
            return Map.of();
        }
        return extractor.extract(
                material,
                updates.current(material.userId()),
                (system, user) -> recorded(material, system, user, claimed.jobId()),
                claimed.jobId());
    }

    /** 기억을 뽑는 호출 한 번을 남긴다 — 람다가 이미 이음매라 추출기는 문자열만 안다. */
    private String recorded(MemoryUpdateMaterial material, String system, String user, UUID jobId) {
        Instant startedAt = Instant.now();
        try {
            var generated = generator.generate(system, user);
            telemetry.record(new LlmCall(
                    LlmStep.MEMORY_EXTRACTION,
                    material.practiceSessionId(),
                    material.userId(),
                    generated.model(),
                    system + "\n\n" + user,
                    generated.text(),
                    generated.usage() == null ? LlmTokens.unknown() : LlmTokens.of(
                            generated.usage().prompt(),
                            generated.usage().completion(),
                            generated.usage().total()),
                    startedAt,
                    Duration.between(startedAt, Instant.now()),
                    null,
                    LlmCall.metadata("blockage_kind", material.blockageKind(), "operation_id", jobId.toString())));
            return generated.text();
        } catch (RuntimeException failure) {
            telemetry.record(new LlmCall(
                    LlmStep.MEMORY_EXTRACTION,
                    material.practiceSessionId(),
                    material.userId(),
                    "",
                    system + "\n\n" + user,
                    "",
                    LlmTokens.unknown(),
                    startedAt,
                    Duration.between(startedAt, Instant.now()),
                    failure.getClass().getSimpleName(),
                    LlmCall.metadata("blockage_kind", material.blockageKind(), "operation_id", jobId.toString())));
            throw failure;
        }
    }
}
