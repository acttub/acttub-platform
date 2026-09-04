package com.acttub.actingapi.feature.analysis.app;

import static org.assertj.core.api.Assertions.assertThat;

import java.net.ConnectException;
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
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.support.RecordingFailureReporter;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.integration.observation.FileActiveTimeout;
import com.acttub.actingapi.integration.observation.ObservationPack;
import com.acttub.actingapi.integration.observation.SummaryParseError;
import org.junit.jupiter.api.Test;
import software.amazon.awssdk.core.exception.SdkClientException;

class AnalysisWorkerTest {
    private static final Instant NOW = Instant.parse("2026-08-12T00:00:00Z");

    @Test
    void externalFailuresFailOrReleaseAndAreReported() {
        assertReportedTransition(
                new FileActiveTimeout("late"), "fail:gemini_timeout", FailureKind.EXTERNAL);
        assertReportedTransition(
                new RuntimeException(new TimeoutException("late")),
                "fail:gemini_timeout",
                FailureKind.EXTERNAL);
        assertReportedTransition(
                new SummaryParseError("bad"), "fail:gemini_parse_error", FailureKind.EXTERNAL);
        assertReportedTransition(
                SdkClientException.builder().message("s3 down").build(),
                "release",
                FailureKind.EXTERNAL);
        assertReportedTransition(
                new ObjectETagMismatchError("changed"), "release", FailureKind.EXTERNAL);
    }

    @Test
    void unsupportedMediaFailsWithoutAReport() {
        assertUnreportedTransition(new UnsupportedMediaError("bad"), "fail:unsupported_media");
    }

    @Test
    void unclassifiedFailureReleasesForRetryAndIsReported() {
        assertReportedTransition(
                new IllegalStateException("unclassified"), "release", FailureKind.UNEXPECTED);
    }

    @Test
    void leaseOwnershipLossAfterAnalysisDoesNotAttemptFailureOrRelease() {
        FakeStore store = new FakeStore(context());
        LeaseOwnershipException leaseLoss = new LeaseOwnershipException("stolen");
        store.completeFailure = leaseLoss;
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        AnalysisWorker worker = worker(
                store,
                (path, context) -> new AnalysisResult(
                        new ObservationPack("", List.of(), List.of()), false),
                reporter);

        assertThat(worker.runOnce(NOW)).isTrue();

        assertThat(store.transitions).containsExactly("claim", "complete");
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(leaseLoss);
            assertThat(report.context())
                    .isEqualTo("AnalysisWorker.complete operation_id=" + store.operationId);
        });
    }

    @Test
    void leaseOwnershipLossWhileFailingOrReleasingIsReported() {
        FakeStore failing = new FakeStore(context());
        failing.failFailure = new LeaseOwnershipException("fail stolen");
        RecordingFailureReporter failReporter = new RecordingFailureReporter();
        worker(
                failing,
                (path, context) -> { throw new SummaryParseError("bad"); },
                failReporter).runOnce(NOW);

        assertThat(failReporter.reports())
                .extracting(RecordingFailureReporter.Report::context)
                .containsExactly(
                        "AnalysisWorker.analysis operation_id=" + failing.operationId,
                        "AnalysisWorker.fail operation_id=" + failing.operationId);

        FakeStore releasing = new FakeStore(context());
        releasing.releaseFailure = new LeaseOwnershipException("release stolen");
        RecordingFailureReporter releaseReporter = new RecordingFailureReporter();
        worker(
                releasing,
                (path, context) -> { throw new IllegalStateException("retry"); },
                releaseReporter).runOnce(NOW);

        assertThat(releaseReporter.reports())
                .extracting(RecordingFailureReporter.Report::context)
                .containsExactly(
                        "AnalysisWorker.analysis operation_id=" + releasing.operationId,
                        "AnalysisWorker.release operation_id=" + releasing.operationId);
    }

    @Test
    void completionNotificationFailureIsReportedWithoutChangingTheCompletedOperation() {
        FakeStore store = new FakeStore(context());
        RuntimeException pushFailure = new RuntimeException(new ConnectException("expo down"));
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        AnalysisWorker worker = new AnalysisWorker(
                store,
                new FakeStorage(),
                (path, context) -> new AnalysisResult(
                        new ObservationPack("", List.of(), List.of()), false),
                Clock.fixed(NOW, ZoneOffset.UTC),
                Duration.ofSeconds(1800),
                "gemini-2.5-flash",
                sessionId -> { throw pushFailure; },
                reporter);

        assertThat(worker.runOnce(NOW)).isTrue();

        assertThat(store.transitions).containsExactly("claim", "complete");
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(pushFailure);
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
            assertThat(report.context()).isEqualTo(
                    "AnalysisWorker.completionNotification operation_id=" + store.operationId);
        });
    }

    @Test
    void expiredUploadDeletionFailureIsReportedWithoutStoppingTheSweep() {
        FakeStore store = new FakeStore(context());
        store.expiredUploads = List.of("expired.mp4");
        FakeStorage storage = new FakeStorage();
        RuntimeException deleteFailure = new RuntimeException(new ConnectException("s3 down"));
        storage.deleteFailure = deleteFailure;
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        AnalysisWorker worker = worker(
                store,
                storage,
                (path, context) -> null,
                null,
                reporter);

        assertThat(worker.sweep(NOW)).isEqualTo(new AnalysisWorker.SweepResult(1, 0));
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(deleteFailure);
            assertThat(report.kind()).isEqualTo(FailureKind.EXTERNAL);
            assertThat(report.context()).isEqualTo("AnalysisWorker.expiredUploadDeletion");
        });
    }

    @Test
    void missingContextAndNonVideoAreUnsupportedWhileEmptyQueueIsNotProcessed() {
        FakeStore missing = new FakeStore(null);
        RecordingFailureReporter missingReporter = new RecordingFailureReporter();
        assertThat(worker(missing, (path, context) -> null, missingReporter).runOnce(NOW)).isTrue();
        assertThat(missing.transitions).containsExactly("claim", "fail:unsupported_media");
        assertThat(missingReporter.reports()).isEmpty();

        AnalysisContext nonVideo = new AnalysisContext(
                UUID.randomUUID(), UUID.randomUUID(), "object.bin", "application/octet-stream",
                "etag", 1, "s", "c", "g", "그 외", null);
        FakeStore invalid = new FakeStore(nonVideo);
        RecordingFailureReporter invalidReporter = new RecordingFailureReporter();
        assertThat(worker(invalid, (path, context) -> null, invalidReporter).runOnce(NOW)).isTrue();
        assertThat(invalid.transitions).containsExactly("claim", "fail:unsupported_media");
        assertThat(invalidReporter.reports()).isEmpty();

        FakeStore idle = new FakeStore(context());
        idle.operationId = null;
        assertThat(worker(idle, (path, context) -> null).runOnce(NOW)).isFalse();
        assertThat(idle.transitions).containsExactly("claim");
    }

    private static void assertReportedTransition(
            RuntimeException failure,
            String expected,
            FailureKind expectedKind) {
        FakeStore store = new FakeStore(context());
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        AnalysisWorker worker = worker(store, (path, context) -> { throw failure; }, reporter);
        assertThat(worker.runOnce(NOW)).isTrue();
        assertThat(store.transitions).containsExactly("claim", expected);
        assertThat(reporter.reports()).singleElement().satisfies(report -> {
            assertThat(report.failure()).isSameAs(failure);
            assertThat(report.kind()).isEqualTo(expectedKind);
            assertThat(report.context())
                    .isEqualTo("AnalysisWorker.analysis operation_id=" + store.operationId);
        });
    }

    private static void assertUnreportedTransition(RuntimeException failure, String expected) {
        FakeStore store = new FakeStore(context());
        RecordingFailureReporter reporter = new RecordingFailureReporter();
        AnalysisWorker worker = worker(store, (path, context) -> { throw failure; }, reporter);
        assertThat(worker.runOnce(NOW)).isTrue();
        assertThat(store.transitions).containsExactly("claim", expected);
        assertThat(reporter.reports()).isEmpty();
    }

    private static AnalysisWorker worker(FakeStore store, AnalysisProcessor analyzer) {
        return worker(store, analyzer, new RecordingFailureReporter());
    }

    private static AnalysisWorker worker(
            FakeStore store,
            AnalysisProcessor analyzer,
            RecordingFailureReporter reporter) {
        return worker(store, new FakeStorage(), analyzer, null, reporter);
    }

    private static AnalysisWorker worker(
            FakeStore store,
            ObjectStorage storage,
            AnalysisProcessor analyzer,
            AnalysisCompletionListener completionListener,
            RecordingFailureReporter reporter) {
        return new AnalysisWorker(
                store,
                storage,
                analyzer,
                Clock.fixed(NOW, ZoneOffset.UTC),
                Duration.ofSeconds(1800),
                "gemini-2.5-flash",
                completionListener,
                reporter);
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
        private RuntimeException failFailure;
        private RuntimeException releaseFailure;
        private List<String> expiredUploads = List.of();

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
            if (failFailure != null) throw failFailure;
            return true;
        }

        @Override
        public void release(UUID operation, UUID token, Instant now) {
            transitions.add("release");
            if (releaseFailure != null) throw releaseFailure;
        }

        @Override public List<String> sweepExpiredUploads(Instant now) { return expiredUploads; }
        @Override public int sweepMaxAttempts(Instant now) { return 0; }
    }

    private static final class FakeStorage implements ObjectStorage {
        private RuntimeException deleteFailure;
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

        @Override
        public void delete(String key) {
            if (deleteFailure != null) throw deleteFailure;
        }
    }
}
