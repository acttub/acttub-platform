package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import java.util.Optional;

import io.sentry.IScope;
import io.sentry.IScopes;
import io.sentry.ScopeCallback;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class SentryFailureReporterTest {

    @Test
    void reportsThroughTheStarterScopesWithTheFailureKindTag() {
        IScopes scopes = mock(IScopes.class);
        SentryFailureReporter reporter = new SentryFailureReporter(Optional.of(scopes));
        RuntimeException failure = new RuntimeException("boom");

        reporter.report(failure, FailureKind.UNEXPECTED, "ApiErrorAdvice.unexpected");

        ArgumentCaptor<ScopeCallback> callback = ArgumentCaptor.forClass(ScopeCallback.class);
        verify(scopes).captureException(same(failure), callback.capture());
        IScope scope = mock(IScope.class);
        callback.getValue().run(scope);
        verify(scope).setTag("failure_kind", "unexpected");
    }

    @Test
    void missingStarterScopesIsANoOp() {
        SentryFailureReporter reporter = new SentryFailureReporter(Optional.empty());

        assertThatCode(() -> reporter.report(
                        new RuntimeException("boom"),
                        FailureKind.UNEXPECTED,
                        "ApiErrorAdvice.unexpected"))
                .doesNotThrowAnyException();
    }
}
