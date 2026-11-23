package com.acttub.actingapi.platform.observability;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

import io.sentry.IScopes;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;

@Component
public class SentryFailureReporter implements FailureReporter {
    private static final Duration SUPPRESSION_WINDOW = Duration.ofMinutes(10);
    private static final Logger LOG = LoggerFactory.getLogger(SentryFailureReporter.class);
    // platform.web.TraceIdFilter 가 넣는 로그 문맥 키. web 이 이 패키지를 쓰므로 반대로 import 하지 않는다.
    private static final String TRACE_ID = "trace_id";

    private final Optional<IScopes> scopes;
    private final Clock clock;
    private final ConcurrentMap<SuppressionKey, Instant> lastReports = new ConcurrentHashMap<>();

    public SentryFailureReporter(Optional<IScopes> scopes, Clock clock) {
        this.scopes = scopes;
        this.clock = clock;
    }

    @Override
    public void report(Throwable failure, FailureKind kind, FailureContext context) {
        Objects.requireNonNull(failure, "failure");
        Objects.requireNonNull(kind, "kind");
        Objects.requireNonNull(context, "context");
        // 억제와 상관없이 매번 한 줄 남긴다. 예외 메시지는 싣지 않는다 — DB 제약 위반 같은 메시지에는 입력값이 들어간다.
        // 메시지와 스택은 Sentry 가 갖고, 이 줄은 trace_id·user_id 로 요청과 잇는다.
        LOG.atError()
                .addKeyValue("failure_location", context.location())
                .addKeyValue("failure_kind", kind.tagValue())
                .addKeyValue("operation_id", context.operationId())
                .addKeyValue("error", failure.getClass().getName())
                .log("failure reported");
        if (scopes.isEmpty() || isSuppressed(failure, context, clock.instant())) {
            return;
        }
        scopes.orElseThrow().captureException(failure, scope -> {
            scope.setTag("failure_kind", kind.tagValue());
            scope.setTag("context", context.tagValue());
            String traceId = MDC.get(TRACE_ID);
            if (traceId != null) {
                scope.setTag(TRACE_ID, traceId);
            }
        });
    }

    private boolean isSuppressed(Throwable failure, FailureContext context, Instant now) {
        SuppressionKey key = new SuppressionKey(context.location(), failure.getClass());
        while (true) {
            Instant previous = lastReports.putIfAbsent(key, now);
            if (previous == null) {
                return false;
            }
            if (now.isBefore(previous.plus(SUPPRESSION_WINDOW))) {
                return true;
            }
            if (lastReports.replace(key, previous, now)) {
                return false;
            }
        }
    }

    private record SuppressionKey(String reportLocation, Class<?> failureClass) {
    }
}
