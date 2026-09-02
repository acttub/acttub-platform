package com.acttub.actingapi.platform.observability;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.same;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;

import java.net.ConnectException;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import io.sentry.IScope;
import io.sentry.IScopes;
import io.sentry.ScopeCallback;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

class SentryFailureReporterTest {
    private static final Instant NOW = Instant.parse("2026-09-03T00:00:00Z");

    @Test
    void reportsThroughTheStarterScopesWithFailureKindAndContextTagsOnly() {
        IScopes scopes = mock(IScopes.class);
        SentryFailureReporter reporter = reporter(scopes, NOW);
        RuntimeException failure = new RuntimeException("boom");
        FailureContext context = new FailureContext(
                "AnalysisWorker.runOnce",
                UUID.fromString("7fef0745-9ea5-45a2-936a-64744e24b801"));

        reporter.report(failure, FailureKind.UNEXPECTED, context);

        ArgumentCaptor<ScopeCallback> callback = ArgumentCaptor.forClass(ScopeCallback.class);
        verify(scopes).captureException(same(failure), callback.capture());
        IScope scope = mock(IScope.class);
        callback.getValue().run(scope);
        verify(scope).setTag("failure_kind", "unexpected");
        verify(scope).setTag("context", context.tagValue());
        verifyNoMoreInteractions(scope);
    }

    @Test
    void suppressesTheSameContextAndExceptionClassForTenMinutes() {
        IScopes scopes = mock(IScopes.class);
        RuntimeException first = new RuntimeException("first");
        RuntimeException repeated = new RuntimeException("repeated");
        RuntimeException afterWindow = new RuntimeException("after window");
        Clock clock = mock(Clock.class);
        org.mockito.Mockito.when(clock.instant()).thenReturn(
                NOW,
                NOW.plusSeconds(599),
                NOW.plusSeconds(600));
        SentryFailureReporter reporter = new SentryFailureReporter(Optional.of(scopes), clock);

        reporter.report(first, FailureKind.UNEXPECTED, operationContext(1));
        reporter.report(repeated, FailureKind.UNEXPECTED, operationContext(2));
        reporter.report(afterWindow, FailureKind.UNEXPECTED, operationContext(3));

        verify(scopes).captureException(same(first), org.mockito.ArgumentMatchers.any(ScopeCallback.class));
        verify(scopes).captureException(same(afterWindow), org.mockito.ArgumentMatchers.any(ScopeCallback.class));
        verify(scopes, times(2)).captureException(
                org.mockito.ArgumentMatchers.any(Throwable.class),
                org.mockito.ArgumentMatchers.any(ScopeCallback.class));
    }

    @Test
    void classifiesTheFailureWhenTheCallerDoesNotSpecifyAKind() {
        IScopes scopes = mock(IScopes.class);
        SentryFailureReporter reporter = reporter(scopes, NOW);

        reporter.report(
                new ConnectException("connection refused"),
                new FailureContext("ApiErrorAdvice.catchAll"));

        ArgumentCaptor<ScopeCallback> callback = ArgumentCaptor.forClass(ScopeCallback.class);
        verify(scopes).captureException(
                org.mockito.ArgumentMatchers.any(ConnectException.class),
                callback.capture());
        IScope scope = mock(IScope.class);
        callback.getValue().run(scope);
        verify(scope).setTag("failure_kind", "external");
    }

    @Test
    void missingStarterScopesIsANoOp() {
        SentryFailureReporter reporter = new SentryFailureReporter(
                Optional.<IScopes>empty(),
                Clock.fixed(NOW, ZoneOffset.UTC));

        assertThatCode(() -> reporter.report(
                        new RuntimeException("boom"),
                        FailureKind.UNEXPECTED,
                        new FailureContext("ApiErrorAdvice.unexpected")))
                .doesNotThrowAnyException();
    }

    private static SentryFailureReporter reporter(IScopes scopes, Instant now) {
        return new SentryFailureReporter(
                Optional.of(scopes),
                Clock.fixed(now, ZoneOffset.UTC));
    }

    private static FailureContext operationContext(int suffix) {
        return new FailureContext(
                "AnalysisWorker.runOnce",
                UUID.fromString("00000000-0000-0000-0000-%012d".formatted(suffix)));
    }
}
