package com.acttub.actingapi.analysis;

import java.io.IOException;
import java.net.http.HttpTimeoutException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.TimeoutException;
import java.util.logging.Level;
import java.util.logging.Logger;

import com.acttub.actingapi.platform.ledger.LeaseOwnershipException;
import com.acttub.actingapi.storage.ObjectStorage;
import com.acttub.actingapi.storage.StoredObjectMetadata;
import com.acttub.actingapi.observation.FileActiveTimeout;
import com.acttub.actingapi.observation.SummaryParseError;

/** 단일 분석 operation을 동기 처리하는 하네스·백그라운드 공용 진입점. */
public class AnalysisWorker {
    public static final Duration DEFAULT_LEASE = Duration.ofSeconds(1800);

    private static final Logger LOGGER = Logger.getLogger(AnalysisWorker.class.getName());

    private final AnalysisStore store;
    private final ObjectStorage storage;
    private final AnalysisProcessor analyzer;
    private final Clock clock;
    private final Duration leaseDuration;
    private final String model;

    public AnalysisWorker(
            AnalysisStore store,
            ObjectStorage storage,
            AnalysisProcessor analyzer,
            Clock clock,
            Duration leaseDuration,
            String model) {
        this.store = store;
        this.storage = storage;
        this.analyzer = analyzer;
        this.clock = clock;
        this.leaseDuration = leaseDuration;
        this.model = model;
    }

    public boolean runOnce() {
        return runOnce(clock.instant());
    }

    public boolean runOnce(Instant now) {
        UUID leaseToken = UUID.randomUUID();
        UUID operationId = store.claimNext(leaseToken, leaseDuration, now);
        if (operationId == null) {
            return false;
        }
        AnalysisContext context = store.getContext(operationId);
        if (context == null) {
            fail(operationId, leaseToken, "unsupported_media", now);
            return true;
        }
        if (context.mimeType() == null
                || !context.mimeType().toLowerCase(Locale.ROOT).startsWith("video/")) {
            fail(operationId, leaseToken, "unsupported_media", now);
            return true;
        }

        Path temporary = null;
        try {
            temporary = Files.createTempFile("acttub-analysis-", suffix(context.objectKey()));
            StoredObjectMetadata downloaded = storage.downloadToPath(
                    context.objectKey(), temporary);
            if (!Objects.equals(downloaded.etag(), context.etag())) {
                throw new ObjectETagMismatchError("uploaded object changed after finalization");
            }
            AnalysisResult result = analyzer.analyze(temporary, context);
            store.complete(operationId, leaseToken, result, model, now);
        } catch (LeaseOwnershipException exception) {
            LOGGER.warning("analysis lease ownership was lost: " + operationId);
        } catch (Exception exception) {
            LOGGER.log(Level.WARNING, "analysis failed: " + operationId, exception);
            String errorCode = errorCode(exception);
            if (errorCode == null) {
                release(operationId, leaseToken, now);
            } else {
                fail(operationId, leaseToken, errorCode, now);
            }
        } finally {
            if (temporary != null) {
                try {
                    Files.deleteIfExists(temporary);
                } catch (IOException ignored) {
                    // 임시 파일 정리 실패는 operation 전이를 바꾸지 않는다.
                }
            }
        }
        return true;
    }

    public SweepResult sweep() {
        return sweep(clock.instant());
    }

    public SweepResult sweep(Instant now) {
        List<String> expired = store.sweepExpiredUploads(now);
        for (String objectKey : expired) {
            try {
                storage.delete(objectKey);
            } catch (Exception exception) {
                LOGGER.log(Level.WARNING,
                        "expired upload object deletion failed: " + objectKey, exception);
            }
        }
        return new SweepResult(expired.size(), store.sweepMaxAttempts(now));
    }

    public static String errorCode(Throwable exception) {
        for (Throwable cause = exception; cause != null; cause = cause.getCause()) {
            if (cause instanceof FileActiveTimeout
                    || cause instanceof TimeoutException
                    || cause instanceof HttpTimeoutException) {
                return "gemini_timeout";
            }
            if (cause instanceof SummaryParseError) {
                return "gemini_parse_error";
            }
            if (cause instanceof UnsupportedMediaError) {
                return "unsupported_media";
            }
        }
        return null;
    }

    private void fail(
            UUID operationId,
            UUID leaseToken,
            String errorCode,
            Instant now) {
        try {
            store.fail(operationId, leaseToken, errorCode, now);
        } catch (LeaseOwnershipException exception) {
            LOGGER.warning("analysis failure lease was lost: " + operationId);
        }
    }

    private void release(UUID operationId, UUID leaseToken, Instant now) {
        try {
            store.release(operationId, leaseToken, now);
        } catch (LeaseOwnershipException exception) {
            LOGGER.warning("analysis retry lease was lost: " + operationId);
        }
    }

    private static String suffix(String objectKey) {
        String name = Path.of(objectKey).getFileName().toString();
        int dot = name.lastIndexOf('.');
        return dot > 0 && dot < name.length() - 1 ? name.substring(dot) : ".video";
    }

    public record SweepResult(int expiredUploads, int exhaustedOperations) {
    }
}
