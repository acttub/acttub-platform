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
import com.acttub.actingapi.platform.ledger.ExternalOperationExecution;
import com.acttub.actingapi.platform.ledger.ExternalOperationFailureClassification;
import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureReporter;
import com.acttub.actingapi.integration.media.FaceMosaic;
import com.acttub.actingapi.integration.media.FaceMosaicRenderer;
import com.acttub.actingapi.integration.storage.ObjectStorage;
import com.acttub.actingapi.integration.storage.StoredObjectMetadata;
import com.acttub.actingapi.integration.observation.FileActiveTimeout;
import com.acttub.actingapi.integration.observation.SummaryParseError;

/** 단일 분석 operation 을 동기 처리하는 진입점. 백그라운드 스케줄러가 이것을 반복 호출한다. */
public class AnalysisWorker {
    private static final Logger LOGGER = Logger.getLogger(AnalysisWorker.class.getName());

    private final AnalysisStore store;
    private final ObjectStorage storage;
    private final AnalysisProcessor analyzer;
    private final Clock clock;
    private final Duration leaseDuration;
    private final String model;
    private final AnalysisCompletionListener completionListener;
    private final FailureReporter failureReporter;
    /** 얼굴 가리기 회차의 사본을 만든다. NONE 이면 그런 회차는 원본을 쓰지 않고 실패로 닫는다. */
    private FaceMosaic faceMosaic = FaceMosaic.NONE;

    /** 얼굴 가리기 회차(practice.start)에서 얼굴을 하나도 찾지 못해 분석을 닫은 사유. 다시 해도 같다. */
    /** 가린 사본을 만들 수 없는 기동(ffmpeg 없음). */
    public static final String FACE_MOSAIC_UNAVAILABLE = "face_mosaic_unavailable";

    public AnalysisWorker(
            AnalysisStore store,
            ObjectStorage storage,
            AnalysisProcessor analyzer,
            Clock clock,
            Duration leaseDuration,
            String model,
            AnalysisCompletionListener completionListener,
            FailureReporter failureReporter) {
        this.store = store;
        this.storage = storage;
        this.analyzer = analyzer;
        this.clock = clock;
        this.leaseDuration = leaseDuration;
        this.model = model;
        this.completionListener = completionListener;
        this.failureReporter = failureReporter;
    }

    /** 얼굴 가리기 회차의 사본을 만들 곳을 끼운다. null 이면 만들 수 없는 것으로 본다. */
    public AnalysisWorker withFaceMosaic(FaceMosaic faceMosaic) {
        this.faceMosaic = faceMosaic == null ? FaceMosaic.NONE : faceMosaic;
        return this;
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
        try (ExternalOperationExecution observation = store.execution(operationId, leaseToken)) {
            AnalysisContext context = store.getContext(operationId);
            if (context == null) {
                fail(operationId, leaseToken, "unsupported_media", null, now);
                return true;
            }
            if (context.mimeType() == null
                    || !context.mimeType().toLowerCase(Locale.ROOT).startsWith("video/")) {
                fail(operationId, leaseToken, "unsupported_media", ExternalOperationFailureClassification.EXPECTED, now);
                return true;
            }

            Path temporary = null;
            Path masked = null;
            try {
                temporary = Files.createTempFile("acttub-analysis-", suffix(context.objectKey()));
                ExternalOperationExecution.externalCall("storage");
                StoredObjectMetadata downloaded = storage.downloadToPath(
                        context.objectKey(), temporary);
                // 검증값을 아는 영상만 견준다 — 예약 장부에 etag 가 없는 영상(옛 자료, 장부를 거치지 않고 들어온
                // 보관함 행)은 견줄 기준이 없고, 없는 것을 불일치로 보면 그 회차는 재큐만 되풀이하다 실패한다.
                if (context.etag() != null && !Objects.equals(downloaded.etag(), context.etag())) {
                    throw new ObjectETagMismatchError("uploaded object changed after finalization");
                }
                Path input = temporary;
                if (context.faceMosaic()) {
                    // 얼굴 가리기: 원본 대신 얼굴을 가린 사본으로 분석하고 코치에게 넘긴다. 가리는 도구가 없거나 사본을
                    // 만들다 깨지면 원본으로 돌아가지 않고 실패로 닫는다(fail-closed). 얼굴이 아예 없으면 원본 그대로 간다.
                    if (!faceMosaic.available()) {
                        failureReporter.report(new IllegalStateException("face mosaic is unavailable"),
                                new FailureContext("AnalysisWorker.faceMosaic", operationId));
                        fail(operationId, leaseToken, FACE_MOSAIC_UNAVAILABLE,
                                ExternalOperationFailureClassification.EXPECTED, now);
                        return true;
                    }
                    try {
                        masked = faceMosaic.render(temporary);
                        input = masked;
                    } catch (FaceMosaicRenderer.NoFaceFound none) {
                        // 얼굴이 한 번도 안 잡히면 가릴 얼굴이 없는 영상으로 보고 원본으로 이어 간다(10/23 결정).
                        LOGGER.info("face mosaic found no face; analyzing the original: " + operationId);
                    }
                }
                AnalysisResult result = analyzer.analyze(input, context);
                store.complete(operationId, leaseToken, result, model, now);
                notifyCompletion(context);
            } catch (LeaseOwnershipException exception) {
                LOGGER.warning("analysis lease ownership was lost: " + operationId);
                failureReporter.report(
                        exception,
                        new FailureContext("AnalysisWorker.complete", operationId));
            } catch (Exception exception) {
                LOGGER.log(Level.WARNING, "analysis failed: " + operationId, exception);
                String errorCode = errorCode(exception);
                if (!"unsupported_media".equals(errorCode)) {
                    failureReporter.report(
                            exception,
                            new FailureContext("AnalysisWorker.analysis", operationId));
                }
                if (errorCode == null) {
                    release(operationId, leaseToken, ExternalOperationFailureClassification.from(exception), now);
                } else {
                    fail(operationId, leaseToken, errorCode,
                            "unsupported_media".equals(errorCode) ? ExternalOperationFailureClassification.EXPECTED
                                    : ExternalOperationFailureClassification.from(exception), now);
                }
            } finally {
                for (Path leftover : new Path[] {masked, temporary}) {
                    if (leftover == null) continue;
                    try {
                        Files.deleteIfExists(leftover);
                    } catch (IOException ignored) {
                        // 임시 파일 정리 실패는 operation 전이를 바꾸지 않는다.
                    }
                }
            }
            return true;
        }
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
            completionListener.onAnalysisComplete(context.sessionId(), context.userId());
        } catch (Exception exception) {
            LOGGER.log(Level.WARNING,
                    "analysis completion notification failed: " + context.sessionId(), exception);
            failureReporter.report(
                    exception,
                    new FailureContext(
                            "AnalysisWorker.completionNotification", context.operationId()));
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
                failureReporter.report(
                        exception,
                        new FailureContext("AnalysisWorker.expiredUploadDeletion"));
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
            String classification,
            Instant now) {
        try {
            store.fail(operationId, leaseToken, errorCode, classification, now);
        } catch (LeaseOwnershipException exception) {
            LOGGER.warning("analysis failure lease was lost: " + operationId);
            failureReporter.report(
                    exception,
                    new FailureContext("AnalysisWorker.fail", operationId));
        }
    }

    private void release(UUID operationId, UUID leaseToken, String classification, Instant now) {
        try {
            store.release(operationId, leaseToken, classification, now);
        } catch (LeaseOwnershipException exception) {
            LOGGER.warning("analysis retry lease was lost: " + operationId);
            failureReporter.report(
                    exception,
                    new FailureContext("AnalysisWorker.release", operationId));
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
