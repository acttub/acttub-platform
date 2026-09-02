package com.acttub.actingapi.platform.observability;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

import io.sentry.IScopes;
import org.springframework.stereotype.Component;

@Component
public class SentryFailureReporter implements FailureReporter {
    private static final Duration SUPPRESSION_WINDOW = Duration.ofMinutes(10);

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
        if (scopes.isEmpty() || isSuppressed(failure, context, clock.instant())) {
            return;
        }
        scopes.orElseThrow().captureException(failure, scope -> {
            scope.setTag("failure_kind", kind.tagValue());
            scope.setTag("context", context.tagValue());
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
