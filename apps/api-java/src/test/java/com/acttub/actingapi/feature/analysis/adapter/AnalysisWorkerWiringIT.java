package com.acttub.actingapi.feature.analysis.adapter;

import static org.assertj.core.api.Assertions.assertThat;

import com.acttub.actingapi.ActingApiApplication;
import com.acttub.actingapi.feature.analysis.app.AnalysisWorker;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.support.PostgresContainerSupport;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.boot.builder.SpringApplicationBuilder;
import org.springframework.context.ConfigurableApplicationContext;

/**
 * 분석 워커가 <b>실제 애플리케이션 컨텍스트에서</b> 만들어지는지 본다.
 *
 * <p>이 검사가 따로 필요한 이유가 있다. 워커의 스토리지 조건이 한때
 * {@code @ConditionalOnBean(ObjectStorage.class)} 였는데, 그 조건은 <b>평가 시점까지
 * 등록된</b> 빈만 보므로 일반 {@code @Configuration} 사이에서는 처리 순서에 따라
 * 결과가 갈린다. 실제로 갈렸다 — {@code StorageConfiguration#objectStorage} 는
 * matched 인데 워커 쪽은 "did not find any beans" 로 통째로 빠졌고, 분석 잡이
 * 큐에 pending 으로 남아 화면이 영원히 "장면을 살펴보고 있어요" 에 머물렀다.
 *
 * <p><b>격리 컨텍스트로는 이 회귀를 잡지 못한다.</b> {@code ApplicationContextRunner}
 * 는 설정 클래스를 직접 지정해 순서가 달라지므로 그 조건이 통과해버린다. 그래서 전체
 * 부팅으로만 확인된다.
 */
class AnalysisWorkerWiringIT {

    @Test
    @DisplayName("스토리지 경계가 있으면 분석 워커가 실제 컨텍스트에 존재한다")
    void workerIsWiredWhenStorageBoundaryExists() {
        try (ConfigurableApplicationContext context = boot(
                "S3_BUCKET=wiring-it-bucket",
                "AWS_REGION=ap-northeast-2")) {
            assertThat(context.getBeanProvider(ObjectStorage.class).getIfAvailable())
                    .describedAs("S3_BUCKET·AWS_REGION 이 있으면 스토리지 경계가 선다")
                    .isNotNull();
            assertThat(context.getBeanProvider(AnalysisWorker.class).getIfAvailable())
                    .describedAs("스토리지가 있는데 워커가 없으면 분석 큐를 아무도 소비하지 않는다")
                    .isNotNull();
        }
    }

    @Test
    @DisplayName("스토리지 경계가 없으면 워커도 없다")
    void workerIsAbsentWithoutStorageBoundary() {
        try (ConfigurableApplicationContext context = boot()) {
            assertThat(context.getBeanProvider(ObjectStorage.class).getIfAvailable()).isNull();
            assertThat(context.getBeanProvider(AnalysisWorker.class).getIfAvailable()).isNull();
        }
    }

    private static ConfigurableApplicationContext boot(String... extraProperties) {
        String databaseUrl = PostgresContainerSupport.deployStyleUrl(
                PostgresContainerSupport.createDatabaseName("worker_wiring_it"));
        String[] properties = new String[extraProperties.length + 6];
        properties[0] = "DATABASE_URL=" + databaseUrl;
        properties[1] = "JWT_SECRET=test-secret";
        properties[2] = "server.port=0";
        properties[3] = "GEMINI_API_KEY=test-not-a-real-key";
        properties[4] = "GEMINI_MODEL=gemini-2.5-flash";
        // 폴링이 실제로 돌아 테스트 DB 를 건드리지 않게 스케줄러는 꺼 둔다.
        // 이 검사가 보는 것은 빈 배선이지 폴링 동작이 아니다.
        properties[5] = "ANALYSIS_WORKER_ENABLED=false";
        System.arraycopy(extraProperties, 0, properties, 6, extraProperties.length);
        return new SpringApplicationBuilder(ActingApiApplication.class)
                .properties(properties)
                .run();
    }
}
