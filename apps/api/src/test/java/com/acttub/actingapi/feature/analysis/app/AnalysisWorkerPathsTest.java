package com.acttub.actingapi.feature.analysis.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.net.http.HttpTimeoutException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.platform.ledger.ExternalOperationExecution;
import com.acttub.actingapi.platform.ledger.ExternalOperationFailureClassification;
import com.acttub.actingapi.support.RecordingFailureReporter;
import org.junit.jupiter.api.Test;

/** practice.analyze: 영상이 아닌 형식, 검증값 없는 옛 영상, 완료 알림, 만료 업로드 정리. */
class AnalysisWorkerPathsTest {
    static final Instant NOW = Instant.parse("2026-08-12T00:00:00Z");
    final AnalysisStore store = mock(AnalysisStore.class);
    final ObjectStorage storage = mock(ObjectStorage.class);
    final RecordingFailureReporter reporter = new RecordingFailureReporter();
    final List<UUID> completed = new ArrayList<>();
    final UUID operation = UUID.randomUUID();
    final UUID session = UUID.randomUUID();

    AnalysisWorkerPathsTest() {
        when(store.execution(any(), any())).thenReturn(ExternalOperationExecution.unobserved());
        when(store.claimNext(any(), any(), eq(NOW))).thenReturn(operation);
        when(storage.downloadToPath(any(), any())).thenAnswer(call -> {
            Files.writeString(call.getArgument(1), "video");
            return new StoredObjectMetadata(5, "video/mp4", "another-etag");
        });
    }

    AnalysisWorker worker(AnalysisProcessor analyzer) {
        return new AnalysisWorker(store, storage, analyzer, Clock.fixed(NOW, ZoneOffset.UTC), Duration.ofSeconds(1800),
                "gemini-2.5-flash", completed::add, reporter);
    }

    AnalysisContext context(String objectKey, String mime, String etag) {
        return new AnalysisContext(operation, session, objectKey, mime, etag, 1, "s", "c", "g", "분석", null, "legacy", UUID.randomUUID());
    }

    @Test void aMissingContentTypeIsUnsupportedWithoutDownloading() {
        when(store.getContext(operation)).thenReturn(context("users/u/uploads/take.mp4", null, "etag"));
        assertThat(worker((path, context) -> { throw new AssertionError("no analysis"); }).runOnce(NOW)).isTrue();
        verify(store).fail(eq(operation), any(), eq("unsupported_media"), eq(ExternalOperationFailureClassification.EXPECTED), eq(NOW));
        assertThat(reporter.reports()).isEmpty();
    }

    @Test void anOldVideoWithoutAnEtagIsAnalysedAndTheSessionIsToldItIsDone() {
        when(store.getContext(operation)).thenReturn(context("users/u/uploads/take", "video/mp4", null));
        List<Path> analysed = new ArrayList<>();
        assertThat(worker((path, context) -> { analysed.add(path); return null; }).runOnce(NOW)).isTrue();
        assertThat(analysed).singleElement().satisfies(path -> {
            assertThat(path.getFileName().toString()).endsWith(".video");
            assertThat(path).doesNotExist();
        });
        verify(store).complete(eq(operation), any(), eq(null), eq("gemini-2.5-flash"), eq(NOW));
        assertThat(completed).containsExactly(session);
    }

    @Test void expiredUploadsAreDeletedFromStorage() {
        when(store.sweepExpiredUploads(NOW)).thenReturn(List.of("users/u/uploads/a.mp4", "users/u/uploads/b.mp4"));
        when(store.sweepMaxAttempts(NOW)).thenReturn(3);
        assertThat(worker((path, context) -> null).sweep(NOW)).isEqualTo(new AnalysisWorker.SweepResult(2, 3));
        verify(storage).delete("users/u/uploads/a.mp4");
        verify(storage).delete("users/u/uploads/b.mp4");
        assertThat(reporter.reports()).isEmpty();
    }

    @Test void errorCodesFollowTheCauseChain() {
        assertThat(AnalysisWorker.errorCode(new RuntimeException(new HttpTimeoutException("slow")))).isEqualTo("gemini_timeout");
        assertThat(AnalysisWorker.errorCode(new IllegalStateException(new UnsupportedMediaError("bad")))).isEqualTo("unsupported_media");
        assertThat(AnalysisWorker.errorCode(new IllegalStateException("other"))).isNull();
    }
}
