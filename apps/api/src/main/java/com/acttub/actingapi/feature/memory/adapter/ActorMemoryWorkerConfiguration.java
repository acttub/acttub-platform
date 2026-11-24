package com.acttub.actingapi.feature.memory.adapter;

import java.time.Clock;

import com.acttub.actingapi.feature.memory.app.ActorMemoryUpdateWorker;
import com.acttub.actingapi.feature.memory.app.ActorMemoryUpdates;
import com.acttub.actingapi.feature.memory.app.MemoryExtractor;
import com.acttub.actingapi.integration.llm.OpenAiTextGenerators;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.platform.observability.LlmTelemetry;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 0.1.0 기억 갱신 워커의 조립 (practice.memory). 큐는 {@code ai_jobs}, 저장은 {@code actor_memories} 다.
 */
@Configuration(proxyBeanMethods = false)
class ActorMemoryWorkerConfiguration {

    @Bean
    ActorMemoryUpdateWorker actorMemoryUpdateWorker(
            ActorMemoryUpdates updates,
            MemoryExtractor extractor,
            OpenAiTextGenerators generators,
            Clock clock,
            FailureReporter failureReporter,
            LlmTelemetry telemetry) {
        return new ActorMemoryUpdateWorker(updates, extractor, generators.memory(), clock, failureReporter, telemetry);
    }
}
