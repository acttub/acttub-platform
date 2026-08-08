package com.acttub.actingapi.harness;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.concurrent.atomic.AtomicLong;

/** contract profile에서 wall clock을 결정적으로 이동시키는 Clock. */
public final class OffsettableClock extends Clock {
    private final Clock base;
    private final AtomicLong offsetNanos;

    public OffsettableClock() {
        this(Clock.systemUTC(), new AtomicLong());
    }

    private OffsettableClock(Clock base, AtomicLong offsetNanos) {
        this.base = base;
        this.offsetNanos = offsetNanos;
    }

    @Override
    public ZoneId getZone() {
        return base.getZone();
    }

    @Override
    public Clock withZone(ZoneId zone) {
        return new OffsettableClock(base.withZone(zone), offsetNanos);
    }

    @Override
    public Instant instant() {
        return base.instant().plusNanos(offsetNanos.get());
    }

    public double advance(double seconds) {
        long nanos = Math.round(seconds * 1_000_000_000d);
        return offsetNanos.addAndGet(nanos) / 1_000_000_000d;
    }

    public long offsetNanos() {
        return offsetNanos.get();
    }

    public void reset() {
        offsetNanos.set(0L);
    }
}
