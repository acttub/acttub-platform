package com.acttub.actingapi.platform.security;

import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.LongSupplier;

/**
 * monotonic 시계 기반 분당 고정 윈도우. compute로 같은 key의 증감을 원자화한다.
 *
 * <p>⚠ <b>카운터는 process-local 이고 지우는 수단이 없다.</b> DB 를 {@code TRUNCATE} 해도
 * 남으므로, 한 컨텍스트 안에서 같은 키를 쓰는 테스트를 여럿 두면 앞의 것이 깎아 놓은 창에
 * 뒤의 것이 걸린다. 비우는 메서드를 다시 들이지 않는 것은 <b>운영 빈이 레이트리밋을 스스로
 * 풀 수 있게 되기 때문</b>이다 — 테스트는 키나 컨텍스트를 나눠서 푼다.
 */
public class FixedWindowRateLimiter {
    private record Counter(long window, int count) {
    }

    private final ConcurrentHashMap<String, Counter> counters = new ConcurrentHashMap<>();
    private final LongSupplier nanoClock;

    public FixedWindowRateLimiter() {
        this(System::nanoTime);
    }

    public FixedWindowRateLimiter(LongSupplier nanoClock) {
        this.nanoClock = nanoClock;
    }

    public boolean allow(String key, int limit) {
        long now = nanoClock.getAsLong();
        long window = now / 60_000_000_000L;
        AtomicBoolean allowed = new AtomicBoolean();
        counters.compute(key, (ignored, old) -> {
            int count = old == null || old.window() != window ? 1 : old.count() + 1;
            allowed.set(count <= limit);
            return new Counter(window, count);
        });
        return allowed.get();
    }
}
