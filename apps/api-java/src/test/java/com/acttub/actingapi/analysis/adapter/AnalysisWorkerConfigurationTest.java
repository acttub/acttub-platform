package com.acttub.actingapi.analysis.adapter;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.analysis.app.AnalysisContext;
import com.acttub.actingapi.analysis.app.AnalysisProcessor;
import com.acttub.actingapi.analysis.app.AnalysisResult;
import com.acttub.actingapi.analysis.app.AnalysisStore;
import com.acttub.actingapi.analysis.app.AnalysisWorker;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class AnalysisWorkerConfigurationTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(AnalysisWorkerConfiguration.class)
            .withBean(AnalysisStore.class, EmptyStore::new)
            .withBean(AnalysisProcessor.class, () -> (path, context) -> null)
            .withBean(Clock.class, Clock::systemUTC);

    /**
     * 스토리지 판정은 {@code @ConditionalOnBean} 이 아니라 런타임 {@code ObjectProvider}
     * 로 한다(그 조건이 설정 처리 순서에 따라 워커를 통째로 빼버린 적이 있다). 그래서
     * 스토리지가 없어도 <b>빈 정의는 남고 값만 비어 있다</b> — 주입은 전부
     * {@code ObjectProvider} 를 거치므로 소비하는 쪽에서는 "없음" 과 같다.
     *
     * <p>이 검사는 격리 컨텍스트라 배선 회귀를 잡지 못한다. 그쪽은
     * {@code AnalysisWorkerWiringIT} 가 전체 부팅으로 본다.
     */
    @Test
    void createsWorkerOnlyWhenStorageBoundaryExists() {
        runner.run(context -> assertThat(
                context.getBeanProvider(AnalysisWorker.class).getIfAvailable()).isNull());

        runner.withBean(ObjectStorage.class, EmptyStorage::new)
                .run(context -> {
                    assertThat(context).hasNotFailed().hasSingleBean(AnalysisWorker.class);
                    assertThat(context.getBeanProvider(AnalysisWorker.class).getIfAvailable())
                            .isNotNull();
                });
    }

    private static final class EmptyStore implements AnalysisStore {
        @Override public UUID claimNext(UUID token, Duration duration, Instant now) { return null; }
        @Override public AnalysisContext getContext(UUID operation) { return null; }
        @Override public UUID complete(UUID operation, UUID token, AnalysisResult result,
                String model, Instant now) { return null; }
        @Override public boolean fail(UUID operation, UUID token, String code, Instant now) {
            return false;
        }
        @Override public void release(UUID operation, UUID token, Instant now) { }
        @Override public List<String> sweepExpiredUploads(Instant now) { return List.of(); }
        @Override public int sweepMaxAttempts(Instant now) { return 0; }
    }

    private static final class EmptyStorage implements ObjectStorage {
        @Override public String presignUpload(String key, String mime, long size, int ttl) {
            return "";
        }
        @Override public String presignPlayback(String key, int ttl) { return ""; }
        @Override public StoredObjectMetadata head(String key) { return null; }
        @Override public StoredObjectMetadata downloadToPath(String key, Path destination) {
            return null;
        }
        @Override public void delete(String key) { }
    }
}
