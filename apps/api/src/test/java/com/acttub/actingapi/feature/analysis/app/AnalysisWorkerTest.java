package com.acttub.actingapi.feature.analysis.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeoutException;

import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.integration.observation.FileActiveTimeout;
import com.acttub.actingapi.integration.observation.ObservationPack;
import com.acttub.actingapi.integration.observation.SummaryParseError;
import org.junit.jupiter.api.Test;

class AnalysisWorkerTest {
    private static final Instant NOW = Instant.parse("2026-08-12T00:00:00Z");

    @Test
    void knownErrorsFailImmediatelyAndOtherErrorsReleaseForRetry() {
        assertTransition(new FileActiveTimeout("late"), "fail:gemini_timeout");
        assertTransition(new RuntimeException(new TimeoutException("late")), "fail:gemini_timeout");
        assertTransition(new SummaryParseError("bad"), "fail:gemini_parse_error");
        assertTransition(new UnsupportedMediaError("bad"), "fail:unsupported_media");
        assertTransition(new IllegalStateException("S3/transient"), "release");
        assertTransition(new ObjectETagMismatchError("changed"), "release");
    }

    @Test
    void leaseOwnershipLossAfterAnalysisDoesNotAttemptFailureOrRelease() {
        FakeStore store = new FakeStore(context());
        store.completeFailure = new LeaseOwnershipException("stolen");
        AnalysisWorker worker = worker(store, (path, context) ->
                new AnalysisResult(new ObservationPack(List.of(), List.of()), false, List.of()));

        assertThat(worker.runOnce(NOW)).isTrue();

        assertThat(store.transitions).containsExactly("claim", "complete");
    }

    @Test
    void missingContextAndNonVideoAreUnsupportedWhileEmptyQueueIsNotProcessed() {
        FakeStore missing = new FakeStore(null);
        assertThat(worker(missing, (path, context) -> null).runOnce(NOW)).isTrue();
        assertThat(missing.transitions).containsExactly("claim", "fail:unsupported_media");

        AnalysisContext nonVideo = new AnalysisContext(
                UUID.randomUUID(), UUID.randomUUID(), "object.bin", "application/octet-stream",
                "etag", 1, "s", "c", "g", "그 외", null);
        FakeStore invalid = new FakeStore(nonVideo);
        assertThat(worker(invalid, (path, context) -> null).runOnce(NOW)).isTrue();
        assertThat(invalid.transitions).containsExactly("claim", "fail:unsupported_media");

        FakeStore idle = new FakeStore(context());
        idle.operationId = null;
        assertThat(worker(idle, (path, context) -> null).runOnce(NOW)).isFalse();
        assertThat(idle.transitions).containsExactly("claim");
    }

    private static void assertTransition(RuntimeException failure, String expected) {
        FakeStore store = new FakeStore(context());
        AnalysisWorker worker = worker(store, (path, context) -> { throw failure; });
        assertThat(worker.runOnce(NOW)).isTrue();
        assertThat(store.transitions).containsExactly("claim", expected);
    }

    private static AnalysisWorker worker(FakeStore store, AnalysisProcessor analyzer) {
        return new AnalysisWorker(
                store,
                new FakeStorage(),
                analyzer,
                Clock.fixed(NOW, ZoneOffset.UTC),
                Duration.ofSeconds(1800),
                "gemini-2.5-flash");
    }

    private static AnalysisContext context() {
        UUID operation = UUID.randomUUID();
        return new AnalysisContext(
                operation, UUID.randomUUID(), "users/u/uploads/take.mp4", "video/mp4",
                "etag", 1, "s", "c", "g", "분석", null);
    }

    private static final class FakeStore implements AnalysisStore {
        private UUID operationId;
        private final AnalysisContext context;
        private final List<String> transitions = new ArrayList<>();
        private RuntimeException completeFailure;

        private FakeStore(AnalysisContext context) {
            this.context = context;
            this.operationId = context == null ? UUID.randomUUID() : context.operationId();
        }

        @Override
        public UUID claimNext(UUID leaseToken, Duration leaseDuration, Instant now) {
            transitions.add("claim");
            return operationId;
        }

        @Override public AnalysisContext getContext(UUID ignored) { return context; }

        @Override
        public UUID complete(UUID operation, UUID token, AnalysisResult result, String model, Instant now) {
            transitions.add("complete");
            if (completeFailure != null) throw completeFailure;
            return UUID.randomUUID();
        }

        @Override
        public boolean fail(UUID operation, UUID token, String code, Instant now) {
            transitions.add("fail:" + code);
            return true;
        }

        @Override
        public void release(UUID operation, UUID token, Instant now) {
            transitions.add("release");
        }

        @Override public List<String> sweepExpiredUploads(Instant now) { return List.of(); }
        @Override public int sweepMaxAttempts(Instant now) { return 0; }
    }

    private static final class FakeStorage implements ObjectStorage {
        @Override public String presignUpload(String key, String mime, long size, int ttl) { return ""; }
        @Override public String presignPlayback(String key, int ttl) { return ""; }
        @Override public StoredObjectMetadata head(String key) { return null; }

        @Override
        public StoredObjectMetadata downloadToPath(String key, Path destination) {
            try {
                Files.writeString(destination, "video");
            } catch (Exception exception) {
                throw new IllegalStateException(exception);
            }
            return new StoredObjectMetadata(5, "video/mp4", "etag");
        }

        @Override public void delete(String key) { }
    }
}
