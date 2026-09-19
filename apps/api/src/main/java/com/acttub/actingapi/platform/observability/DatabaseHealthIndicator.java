package com.acttub.actingapi.platform.observability;

import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Future;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.SynchronousQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

import jakarta.persistence.EntityManagerFactory;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;

/** A status-only JPA connectivity probe with bounded HTTP wait and at most one database caller. */
@Component("dbHealthIndicator")
public class DatabaseHealthIndicator implements HealthIndicator, DisposableBean {
    private static final Health UP = Health.up().build();
    private static final Health DOWN = Health.down().build();
    private final EntityManagerFactory entityManagers;
    private final MonitoringFailures failures;
    private final ExecutorService probes = new ThreadPoolExecutor(
            1, 1, 0, TimeUnit.MILLISECONDS, new SynchronousQueue<>(),
            Thread.ofVirtual().name("db-health-", 0).factory(), new ThreadPoolExecutor.AbortPolicy());

    public DatabaseHealthIndicator(EntityManagerFactory entityManagers, MonitoringFailures failures) {
        this.entityManagers = entityManagers;
        this.failures = failures;
    }

    @Override
    public Health health() {
        Future<Health> probe;
        try {
            probe = probes.submit(this::checkDatabase);
        } catch (RejectedExecutionException saturated) {
            return DOWN;
        }
        try {
            // Query timeout alone does not bound pool acquisition or connection establishment.
            return probe.get(2, TimeUnit.SECONDS);
        } catch (TimeoutException timeout) {
            probe.cancel(true);
            failures.report(timeout, "DatabaseHealthIndicator.timeout");
            return DOWN;
        } catch (InterruptedException interrupted) {
            probe.cancel(true);
            Thread.currentThread().interrupt();
            return DOWN;
        } catch (ExecutionException unavailable) {
            failures.report(unavailable.getCause(), "DatabaseHealthIndicator.database");
            return DOWN;
        }
    }

    private Health checkDatabase() {
        var entityManager = entityManagers.createEntityManager();
        try {
            // CONTRACT §5-1: connectivity also uses JPA, without changing the business connection pool settings.
            entityManager.createNativeQuery("SELECT 1")
                    .setHint("jakarta.persistence.query.timeout", 1000).getSingleResult();
            return UP;
        } finally {
            entityManager.close();
        }
    }

    @Override
    public void destroy() {
        probes.shutdownNow();
    }
}
