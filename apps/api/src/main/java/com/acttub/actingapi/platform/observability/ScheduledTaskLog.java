package com.acttub.actingapi.platform.observability;

import java.util.function.BooleanSupplier;

import io.micrometer.observation.Observation;
import io.micrometer.observation.ObservationHandler;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.event.Level;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.support.ScheduledTaskObservationContext;
import org.springframework.stereotype.Component;
import org.springframework.util.ClassUtils;

/**
 * 주기 작업 한 줄(필드는 docs/deploy/DEPLOY-HOME.md 「로그」). 모든 {@code @Scheduled} 회차를 Spring 의 관측으로 한 곳에서 본다.
 *
 * <p>몇 초마다 도는 폴이 여럿이라 회차마다 남기면 양이 많다. 그래서 실패했거나(예외가 밖으로 나옴), cron 작업이거나(하루·시간
 * 단위라 적다), 1초 이상 걸린 회차만 남긴다. 일감을 비우는 반복은 {@link #drained} 로 처리한 수가 있을 때만 남긴다 — 그 반복은
 * 대개 폴이 띄운 다른 스레드에서 돌아 관측이 보지 못한다.
 */
@Component
public class ScheduledTaskLog implements ObservationHandler<ScheduledTaskObservationContext> {
    static final long SLOW_MS = 1_000;
    private static final Logger LOG = LoggerFactory.getLogger(ScheduledTaskLog.class);

    /** {@code once} 가 false 를 낼 때까지 돌리고 처리한 수를 남긴다. 예외는 그대로 던진다(그때까지 처리한 수는 남긴다). */
    public static void drain(String task, BooleanSupplier once) {
        long started = System.nanoTime();
        int processed = 0;
        try {
            while (once.getAsBoolean()) {
                processed++;
            }
        } finally {
            drained(task, processed, started);
        }
    }

    /** 일감 비우기 한 번이 끝났을 때 부른다. 처리한 것이 없으면 남기지 않는다. */
    public static void drained(String task, int processed, long startedNanos) {
        if (processed > 0) {
            LOG.atInfo()
                    .addKeyValue("task", task)
                    .addKeyValue("processed", processed)
                    .addKeyValue("took_ms", (System.nanoTime() - startedNanos) / 1_000_000)
                    .log("scheduled drain");
        }
    }

    @Override
    public boolean supportsContext(Observation.Context context) {
        return context instanceof ScheduledTaskObservationContext;
    }

    @Override
    public void onStart(ScheduledTaskObservationContext context) {
        context.put(ScheduledTaskLog.class, System.nanoTime());
    }

    @Override
    public void onStop(ScheduledTaskObservationContext context) {
        if (!(context.get(ScheduledTaskLog.class) instanceof Long started)) return;
        long tookMs = (System.nanoTime() - started) / 1_000_000;
        Scheduled scheduled = context.getMethod().getAnnotation(Scheduled.class);
        boolean cron = scheduled != null && !scheduled.cron().isEmpty();
        Throwable error = context.getError();
        if (error == null && !cron && tookMs < SLOW_MS) return;
        var line = LOG.atLevel(error == null ? Level.INFO : Level.ERROR)
                .addKeyValue("task", ClassUtils.getUserClass(context.getTargetClass()).getSimpleName()
                        + "." + context.getMethod().getName())
                .addKeyValue("outcome", error == null ? "success" : "error")
                .addKeyValue("took_ms", tookMs);
        if (error != null) line = line.addKeyValue("error", error.getClass().getName());
        line.log("scheduled run");
    }
}
