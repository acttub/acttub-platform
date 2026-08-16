package com.acttub.actingapi.security;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.LongSupplier;

/**
 * monotonic 시계 기반 분당 고정 윈도우. compute로 같은 key의 증감을 원자화한다.
 *
 * <p>빈 등록은 {@link RateLimiterConfiguration}이 프로파일별로 한다 — 아래 제어
 * 메서드 둘은 하네스의 것이라 운영 빈에서는 동작하지 않아야 한다.
 */
public class FixedWindowRateLimiter {
    private record Counter(long window, int count) {
    }

    private final ConcurrentHashMap<String, Counter> counters = new ConcurrentHashMap<>();
    private final LongSupplier nanoClock;
    private final AtomicLong contractOffsetNanos = new AtomicLong();
    private final boolean contractControlAllowed;

    public FixedWindowRateLimiter() {
        this(System::nanoTime);
    }

    public FixedWindowRateLimiter(LongSupplier nanoClock) {
        this(nanoClock, false);
    }

    public FixedWindowRateLimiter(LongSupplier nanoClock, boolean contractControlAllowed) {
        this.nanoClock = nanoClock;
        this.contractControlAllowed = contractControlAllowed;
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
        requireContractControl();
        contractOffsetNanos.addAndGet(nanos);
    }

    /** DB truncate로 없어지지 않는 process-local 상태를 초기화한다. */
    public void reset() {
        requireContractControl();
        counters.clear();
        contractOffsetNanos.set(0L);
    }

    private void requireContractControl() {
        if (!contractControlAllowed) {
            throw new IllegalStateException("레이트리밋 제어는 contract 프로파일에서만 쓴다");
        }
    }
}
