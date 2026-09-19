package com.acttub.actingapi.support;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;

import io.sentry.IScope;
import io.sentry.IScopes;
import io.sentry.ScopeCallback;
import io.sentry.protocol.SentryId;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/** Replaces only Sentry's external SDK boundary; the real classifier/reporter/suppression still run. */
@TestConfiguration(proxyBeanMethods = false)
public class MonitoringFailureFixture {
    @Bean
    public MetricClock monitoringMetricClock() {
        return new MetricClock();
    }

    /** The registry clock is an external boundary independent of the business Clock. */
    public static final class MetricClock implements io.micrometer.core.instrument.Clock {
        public final ThreadLocal<RuntimeException> failure = new ThreadLocal<>();

        @Override
        public long wallTime() {
            return SYSTEM.wallTime();
        }

        @Override
        public long monotonicTime() {
            if (failure.get() != null) throw failure.get();
            return SYSTEM.monotonicTime();
        }
    }

    @Bean
    public Sink monitoringFailureSink() {
        return new Sink();
    }

    @Bean
    @Primary
    public IScopes monitoringScopes(Sink sink) {
        return sink.scopes;
    }

    public static final class Sink {
        private final IScopes scopes = mock(IScopes.class);
        private final List<Report> reports = new CopyOnWriteArrayList<>();
        public volatile boolean throwOnReport;
        public volatile CountDownLatch release = new CountDownLatch(0);

        Sink() {
            when(scopes.getOptions()).thenReturn(new io.sentry.SentryOptions());
            when(scopes.captureException(any(Throwable.class), any(ScopeCallback.class))).thenAnswer(call -> {
                Map<String, String> tags = new HashMap<>();
                IScope scope = mock(IScope.class);
                doAnswer(tag -> { tags.put(tag.getArgument(0), tag.getArgument(1)); return null; })
                        .when(scope).setTag(anyString(), anyString());
                call.<ScopeCallback>getArgument(1).run(scope);
                reports.add(new Report(call.getArgument(0), Map.copyOf(tags)));
                String context = tags.getOrDefault("context", "");
                if (context.startsWith("DatabaseHealthIndicator.") || context.startsWith("ExternalOperationMetrics.")) {
                    release.await();
                    if (throwOnReport) throw new IllegalStateException("Sentry fixture unavailable");
                }
                return SentryId.EMPTY_ID;
            });
        }

        public List<Report> at(String context) {
            return reports.stream().filter(report -> context.equals(report.tags().get("context"))).toList();
        }

        public record Report(Throwable cause, Map<String, String> tags) { }
    }
}
