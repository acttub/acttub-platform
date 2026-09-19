package com.acttub.actingapi.platform.security;

import java.time.Duration;
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

    private static final Duration MINUTE = Duration.ofMinutes(1);

    private final ConcurrentHashMap<String, Counter> counters = new ConcurrentHashMap<>();
    private final LongSupplier nanoClock;

    public FixedWindowRateLimiter() {
        this(System::nanoTime);
    }

    public FixedWindowRateLimiter(LongSupplier nanoClock) {
        this.nanoClock = nanoClock;
    }

    public boolean allow(String key, int limit) {
        return allow(key, limit, MINUTE);
    }

    /**
     * 창의 길이를 고른다(게스트 만들기는 시간당으로 센다). 같은 키는 늘 같은 길이로 불러야 한다 —
     * 창 번호가 길이에서 나온다.
     */
    public boolean allow(String key, int limit, Duration window) {
        long number = nanoClock.getAsLong() / window.toNanos();
        AtomicBoolean allowed = new AtomicBoolean();
        counters.compute(key, (ignored, old) -> {
            int count = old == null || old.window() != number ? 1 : old.count() + 1;
            allowed.set(count <= limit);
            return new Counter(number, count);
        });
        return allowed.get();
    }

    /**
     * <b>틀린 시도만</b> 세는 자리에서 쓴다: 평가하기 전에 자리를 먼저 잡고, 틀리지 않았으면
     * {@link Reservation#release} 로 되돌려 준다. 한도를 읽고 평가한 뒤에 세면 겹쳐 온 요청이 모두 같은
     * 수를 보고 지나가므로, 확인과 증가를 한 {@code compute} 로 묶는다 — 평가 중인 시도도 자리를 차지한다.
     *
     * @return 이번 창의 자리가 다 찼으면 {@code null}
     */
    public Reservation reserve(String key, int limit) {
        long number = nanoClock.getAsLong() / MINUTE.toNanos();
        AtomicBoolean reserved = new AtomicBoolean();
        counters.compute(key, (ignored, old) -> {
            int count = old == null || old.window() != number ? 0 : old.count();
            reserved.set(count < limit);
            return new Counter(number, reserved.get() ? count + 1 : count);
        });
        return reserved.get() ? new Reservation(key, number) : null;
    }

    /** {@link #reserve} 로 잡은 자리 하나. 되돌려 주지 않으면 그 창이 끝날 때까지 센 채로 남는다. */
    public final class Reservation {
        private final String key;
        private final long window;
        private final AtomicBoolean released = new AtomicBoolean();

        private Reservation(String key, long window) {
            this.key = key;
            this.window = window;
        }

        /** 창이 이미 넘어갔으면 아무것도 하지 않는다 — 새 창의 수는 이 자리를 센 적이 없다. */
        public void release() {
            if (!released.compareAndSet(false, true)) {
                return;
            }
            counters.computeIfPresent(key, (ignored, old) ->
                    old.window() == window && old.count() > 0 ? new Counter(window, old.count() - 1) : old);
        }
    }
}
