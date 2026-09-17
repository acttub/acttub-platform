package com.acttub.actingapi.platform.observability;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.stereotype.Component;

/** Reports monitoring failures without letting Sentry delay health probes or business commits. */
@Component
public class MonitoringFailures implements DisposableBean {
    private static final Logger LOG = LoggerFactory.getLogger(MonitoringFailures.class);
    private final FailureReporter reporter;
    private final ThreadPoolExecutor reports = new ThreadPoolExecutor(
            1, 1, 0, TimeUnit.MILLISECONDS, new ArrayBlockingQueue<>(16),
            Thread.ofVirtual().name("monitoring-failure-", 0).factory(), new ThreadPoolExecutor.AbortPolicy());

    public MonitoringFailures(FailureReporter reporter) {
        this.reporter = reporter;
    }

    public void report(Throwable cause, String location) {
        try {
            reports.execute(() -> {
                try {
                    // The existing reporter classifies the original cause and applies its 10-minute suppression.
                    reporter.report(cause, new FailureContext(location));
                } catch (RuntimeException reportingFailure) {
                    LOG.warn("Monitoring failure reporting failed at {}: {}", location,
                            reportingFailure.getClass().getSimpleName());
                }
            });
        } catch (RejectedExecutionException saturated) {
            // Bounded, best-effort reporting: no accumulating threads or unbounded retained exceptions.
            LOG.warn("Monitoring failure reporting is busy at {}", location);
        }
    }

    @Override
    public void destroy() {
        reports.shutdownNow();
    }
}
