package com.acttub.actingapi.platform.observability;

import java.util.Optional;

import io.sentry.IScopes;
import org.springframework.stereotype.Component;

@Component
public class SentryFailureReporter implements FailureReporter {
    private final Optional<IScopes> scopes;

    public SentryFailureReporter(Optional<IScopes> scopes) {
        this.scopes = scopes;
    }

    @Override
    public void report(Throwable failure, FailureKind kind, String context) {
        scopes.ifPresent(value -> value.captureException(
                failure,
                scope -> scope.setTag("failure_kind", kind.tagValue())));
    }
}
