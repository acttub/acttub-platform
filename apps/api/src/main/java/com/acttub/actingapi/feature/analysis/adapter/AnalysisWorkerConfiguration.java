package com.acttub.actingapi.feature.analysis.adapter;

import java.time.Clock;
import java.time.Duration;

import com.acttub.actingapi.feature.analysis.app.AnalysisCompletionListener;
import com.acttub.actingapi.feature.analysis.app.AnalysisProcessor;
import com.acttub.actingapi.feature.analysis.app.AnalysisWorker;
import com.acttub.actingapi.feature.analysis.app.PracticeAnalysisStore;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.platform.observability.FailureReporter;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import com.acttub.actingapi.integration.media.FaceMosaic;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration(proxyBeanMethods = false)
class AnalysisWorkerConfiguration {

    /**
     * 0.1.0 회차의 분석 워커 (practice.analyze). {@code ai_jobs} 를 집고 {@code analyses}·{@code video_transcripts} 에
     * 쓴다. 옛 원장({@code external_operations})을 집던 워커는 SOMA-1140 에서 지웠다.
     *
     * <p>스토리지 경계가 없으면 워커도 없다. 이 판정을 {@code @ConditionalOnBean(ObjectStorage.class)} 로 하면 안 된다 —
     * 그 조건은 <b>평가 시점까지 등록된</b> 빈만 보므로 설정 클래스 처리 순서에 따라 결과가 갈린다. 실제로 그렇게 갈려
     * 워커가 통째로 빠지고 분석 잡이 pending 으로 영원히 남은 적이 있다. 격리 컨텍스트로 도는 단위 테스트는 이 구멍을
     * 통과시키고 전체 부팅으로만 잡힌다({@code AnalysisWorkerWiringIT}). {@code ObjectProvider} 로 받아 런타임에
     * 판정하면 순서와 무관해진다.
     */
    @Bean
    AnalysisWorker practiceAnalysisWorker(
            PracticeAnalysisStore store,
            ObjectProvider<ObjectStorage> storage,
            AnalysisProcessor analyzer,
            Clock clock,
            @Value("${ANALYSIS_LEASE_SEC:1800}") long leaseSeconds,
            @Value("${GEMINI_MODEL:gemini-2.5-flash}") String model,
            ObjectProvider<AnalysisCompletionListener> completionListener,
            FailureReporter failureReporter,
            // 얼굴 가리기 회차는 원본 대신 얼굴을 가린 사본으로 분석한다(practice.start). 없으면 그 회차는 실패로 닫힌다.
            ObjectProvider<FaceMosaic> faceMosaic) {
        if (leaseSeconds <= 0) {
            throw new IllegalStateException("analysis worker settings must be positive");
        }
        ObjectStorage objectStorage = storage.getIfAvailable();
        if (objectStorage == null) {
            return null;
        }
        return new AnalysisWorker(
                store, objectStorage, analyzer, clock, Duration.ofSeconds(leaseSeconds), model,
                AnalysisCompletionListener.all(completionListener.orderedStream().toList()), failureReporter)
                .withFaceMosaic(faceMosaic.getIfAvailable(() -> FaceMosaic.NONE));
    }
}
