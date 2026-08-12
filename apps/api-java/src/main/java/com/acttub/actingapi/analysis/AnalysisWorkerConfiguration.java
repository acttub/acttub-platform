package com.acttub.actingapi.analysis;

import java.time.Clock;
import java.time.Duration;

import com.acttub.actingapi.storage.ObjectStorage;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class AnalysisWorkerConfiguration {

    @Bean
    @ConditionalOnBean(ObjectStorage.class)
    AnalysisWorker analysisWorker(
            AnalysisStore store,
            ObjectStorage storage,
            AnalysisProcessor analyzer,
            Clock clock,
            @Value("${ANALYSIS_LEASE_SEC:1800}") long leaseSeconds,
            @Value("${GEMINI_MODEL:gemini-2.5-flash}") String model) {
        if (leaseSeconds <= 0) {
            throw new IllegalStateException("analysis worker settings must be positive");
        }
        return new AnalysisWorker(
                store, storage, analyzer, clock, Duration.ofSeconds(leaseSeconds), model);
    }
}
