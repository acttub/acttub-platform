package com.acttub.actingapi.feature.memory.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.memory.app.ActorMemoryUpdateWorker;
import com.acttub.actingapi.feature.memory.app.ActorMemoryUpdates;
import com.acttub.actingapi.feature.memory.app.MemoryExtractor;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 1.0.0 기억 갱신 워커의 조립 (practice.memory). 옛 워커({@code MemoryUpdateWorker})와 같은 추출기를 쓰고
 * 큐와 저장만 새 것({@code ai_jobs}·{@code actor_memories})이다.
 */
@Configuration(proxyBeanMethods = false)
class ActorMemoryWorkerConfiguration {

    @Bean
    ActorMemoryUpdateWorker actorMemoryUpdateWorker(
            ActorMemoryUpdates updates,
            MemoryExtractor extractor,
            TextGenerator generator,
            Clock clock,
            FailureReporter failureReporter,
            LlmTelemetry telemetry) {
        return new ActorMemoryUpdateWorker(updates, extractor, generator, clock, failureReporter, telemetry);
    }
}
