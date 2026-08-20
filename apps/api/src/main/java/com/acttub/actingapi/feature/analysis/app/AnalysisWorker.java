package com.acttub.actingapi.feature.analysis.app;

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
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.integration.observation.FileActiveTimeout;
import com.acttub.actingapi.integration.observation.SummaryParseError;

/** 단일 분석 operation 을 동기 처리하는 진입점. 백그라운드 스케줄러가 이것을 반복 호출한다. */
public class AnalysisWorker {
    public static final Duration DEFAULT_LEASE = Duration.ofSeconds(1800);

    private static final Logger LOGGER = Logger.getLogger(AnalysisWorker.class.getName());

    private final AnalysisStore store;
    private final ObjectStorage storage;
    private final AnalysisProcessor analyzer;
    private final Clock clock;
    private final Duration leaseDuration;
    private final String model;
    private final AnalysisCompletionListener completionListener;

    public AnalysisWorker(
            AnalysisStore store,
            ObjectStorage storage,
            AnalysisProcessor analyzer,
            Clock clock,
            Duration leaseDuration,
            String model) {
        this(store, storage, analyzer, clock, leaseDuration, model, null);
    }

    public AnalysisWorker(
            AnalysisStore store,
            ObjectStorage storage,
            AnalysisProcessor analyzer,
            Clock clock,
            Duration leaseDuration,
            String model,
            AnalysisCompletionListener completionListener) {
        this.store = store;
        this.storage = storage;
        this.analyzer = analyzer;
        this.clock = clock;
        this.leaseDuration = leaseDuration;
        this.model = model;
        this.completionListener = completionListener;
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
            notifyCompletion(context);
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

    /**
     * 완료 전이 <b>후</b>의 통지. 예외를 여기서 삼키지 않으면 바깥 catch 가 이미 완료된
     * operation 에 fail 을 시도한다 — 알림이 분석의 결과를 바꾸는 사고이므로 전부 로그로 끝낸다.
     */
    private void notifyCompletion(AnalysisContext context) {
        if (completionListener == null) {
            return;
        }
        try {
            completionListener.onAnalysisComplete(context.sessionId());
        } catch (Exception exception) {
            LOGGER.log(Level.WARNING,
                    "analysis completion notification failed: " + context.sessionId(), exception);
        }
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
