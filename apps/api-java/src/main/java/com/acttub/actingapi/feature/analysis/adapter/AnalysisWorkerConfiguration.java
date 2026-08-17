package com.acttub.actingapi.feature.analysis.adapter;

import java.time.Clock;
import java.time.Duration;

import com.acttub.actingapi.feature.analysis.app.AnalysisProcessor;
import com.acttub.actingapi.feature.analysis.app.AnalysisStore;
import com.acttub.actingapi.feature.analysis.app.AnalysisWorker;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class AnalysisWorkerConfiguration {

    /**
     * 스토리지 경계가 없으면 워커도 없다. Python 도 {@code s3_storage is not None} 일
     * 때만 풀을 만든다({@code app.py:create_app}).
     *
     * <p>이 판정을 {@code @ConditionalOnBean(ObjectStorage.class)} 로 하면 안 된다 —
     * 그 조건은 <b>평가 시점까지 등록된</b> 빈만 보므로, 일반 {@code @Configuration}
     * 사이에서는 설정 클래스 처리 순서에 따라 결과가 갈린다. 실제로 그렇게 갈렸다:
     * {@code StorageConfiguration#objectStorage} 는 matched 인데
     * {@code @ConditionalOnBean} 은 "did not find any beans" 로 워커를 통째로
     * 빼버렸고, 분석 잡이 큐에 pending 으로 영원히 남았다. 하네스는 contract
     * 프로파일에서 백그라운드 워커를 띄우지 않는 것이 전제라 이 구멍을 볼 수 없고,
     * 격리 컨텍스트로 도는 단위 테스트도 순서가 달라 통과했다.
     *
     * <p>{@code ObjectProvider} 로 받아 런타임에 판정하면 순서와 무관해진다.
     */
    @Bean
    AnalysisWorker analysisWorker(
            AnalysisStore store,
            ObjectProvider<ObjectStorage> storage,
            AnalysisProcessor analyzer,
            Clock clock,
            @Value("${ANALYSIS_LEASE_SEC:1800}") long leaseSeconds,
            @Value("${GEMINI_MODEL:gemini-2.5-flash}") String model) {
        if (leaseSeconds <= 0) {
            throw new IllegalStateException("analysis worker settings must be positive");
        }
        ObjectStorage objectStorage = storage.getIfAvailable();
        if (objectStorage == null) {
            return null;
        }
        return new AnalysisWorker(
                store, objectStorage, analyzer, clock, Duration.ofSeconds(leaseSeconds), model);
    }
}
