package com.acttub.actingapi.platform.observability;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.BooleanSupplier;

/**
 * 큐 비우기를 자기 스레드 하나에서 돈다. 주기 작업의 폴은 {@link #poll} 을 부르고 바로 돌아온다.
 *
 * <p>공용 스케줄러에서 직접 비우면 일이 쌓였을 때 그동안 다른 예약 작업(대본 나누기 등)이 차례를 받지 못한다 — 2026-11-04 쌓인
 * 다시 받아쓰기 640건이 공용 스레드를 347초 붙잡아 대본 나누기가 10~20분 밀렸다. 폴은 비우기가 돌고 있으면 바로 돌아오고, 돌고
 * 있지 않을 때만 하나를 띄운다.
 *
 * <p>보고 문맥과 로그 이름은 주인 클래스 이름 뒤에 {@code .poll}(실행기가 거절함)과 {@code .drain}(비우기 실패, 처리한 수)을
 * 붙인다. 주인은 {@code @PreDestroy} 에서 {@link #shutdown} 을 부른다.
 */
public final class SingleThreadDrain {
    private final String pollContext;
    private final String drainContext;
    private final FailureReporter failures;
    private final Runnable before;
    private final BooleanSupplier once;
    private final AtomicBoolean draining = new AtomicBoolean();
    private final ExecutorService executor;

    /** 비우기는 {@code once} 가 false 를 낼 때까지 돌린다. */
    public SingleThreadDrain(Class<?> owner, String threadName, FailureReporter failures, BooleanSupplier once) {
        this(owner, threadName, failures, () -> {}, once);
    }

    /** 비우기마다 {@code before} 를 먼저 한 번 부른다. 그 실패도 비우기 실패로 알린다. */
    public SingleThreadDrain(
            Class<?> owner, String threadName, FailureReporter failures, Runnable before, BooleanSupplier once) {
        this.pollContext = owner.getSimpleName() + ".poll";
        this.drainContext = owner.getSimpleName() + ".drain";
        this.failures = failures;
        this.before = before;
        this.once = once;
        this.executor = Executors.newSingleThreadExecutor(Thread.ofPlatform().name(threadName).daemon(true).factory());
    }

    public void poll() {
        if (!draining.compareAndSet(false, true)) {
            return;
        }
        try {
            executor.execute(() -> {
                try {
                    drain();
                } finally {
                    draining.set(false);
                }
            });
        } catch (RuntimeException rejected) {
            draining.set(false);
            failures.report(rejected, new FailureContext(pollContext));
        }
    }

    /** 집을 것이 없을 때까지 하나씩 처리한다. 실패는 알리고 다음 폴을 기다린다. 부른 스레드에서 돈다. */
    public void drain() {
        try {
            before.run();
            // 쌓인 것을 다 비운다. 집을 것이 없거나 한도·실패로 멈추면 다음 주기를 기다린다.
            ScheduledTaskLog.drain(drainContext, once);
        } catch (RuntimeException failure) {
            failures.report(failure, new FailureContext(drainContext));
        }
    }

    public void shutdown() {
        executor.shutdownNow();
    }
}
