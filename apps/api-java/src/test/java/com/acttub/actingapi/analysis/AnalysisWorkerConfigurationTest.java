package com.acttub.actingapi.analysis;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.storage.ObjectStorage;
import com.acttub.actingapi.storage.StoredObjectMetadata;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class AnalysisWorkerConfigurationTest {
    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withUserConfiguration(AnalysisWorkerConfiguration.class)
            .withBean(AnalysisStore.class, EmptyStore::new)
            .withBean(AnalysisProcessor.class, () -> (path, context) -> null)
            .withBean(Clock.class, Clock::systemUTC);

    @Test
    void createsWorkerOnlyWhenStorageBoundaryExists() {
        runner.run(context -> assertThat(context).doesNotHaveBean(AnalysisWorker.class));

        runner.withBean(ObjectStorage.class, EmptyStorage::new)
                .run(context -> assertThat(context)
                        .hasNotFailed()
                        .hasSingleBean(AnalysisWorker.class));
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
