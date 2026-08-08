package com.acttub.actingapi.auth;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;

import org.springframework.stereotype.Component;

/** monotonic 시계 기반 분당 고정 윈도우. compute로 같은 key의 증감을 원자화한다. */
@Component
public class FixedWindowRateLimiter {
    private record Counter(long window, int count) {
    }

    private final ConcurrentHashMap<String, Counter> counters = new ConcurrentHashMap<>();
    private final LongSupplier nanoClock;
    private final AtomicLong contractOffsetNanos = new AtomicLong();

    public FixedWindowRateLimiter() {
        this(System::nanoTime);
    }

    public FixedWindowRateLimiter(LongSupplier nanoClock) {
        this.nanoClock = nanoClock;
    }

    public boolean allow(String key, int limit) {
        long now = nanoClock.getAsLong() + contractOffsetNanos.get();
        long window = now / 60_000_000_000L;
        AtomicBoolean allowed = new AtomicBoolean();
        counters.compute(key, (ignored, old) -> {
            int count = old == null || old.window() != window ? 1 : old.count() + 1;
            allowed.set(count <= limit);
            return new Counter(window, count);
        });
        return allowed.get();
    }

    /** contract 제어 시계가 움직인 만큼 monotonic 윈도우도 함께 움직인다. */
    public void advanceContractClock(long nanos) {
        contractOffsetNanos.addAndGet(nanos);
    }

    /** DB truncate로 없어지지 않는 process-local 상태를 초기화한다. */
    public void reset() {
        counters.clear();
        contractOffsetNanos.set(0L);
    }
}
