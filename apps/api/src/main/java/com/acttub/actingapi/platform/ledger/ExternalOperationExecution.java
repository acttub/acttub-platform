package com.acttub.actingapi.platform.ledger;

import java.util.UUID;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.Supplier;

/** A synchronous execution scope: no UUID becomes a metric label and no completed scope is retained. */
public final class ExternalOperationExecution implements AutoCloseable {
    private static final ThreadLocal<ExternalOperationExecution> CURRENT = new ThreadLocal<>();
    private final UUID operationId;
    private final BooleanSupplier start;
    private final Consumer<String> onCall;
    private final Supplier<Long> nanoTime;
    private final ExternalOperationExecution previous;
    private Long startedAt;
    private boolean attempted;

    public ExternalOperationExecution(UUID operationId, BooleanSupplier start, Consumer<String> onCall, Supplier<Long> nanoTime) {
        this.operationId = operationId;
        this.start = start;
        this.onCall = onCall;
        this.nanoTime = nanoTime;
        this.previous = CURRENT.get();
        CURRENT.set(this);
    }

    public static ExternalOperationExecution unobserved() {
        return new ExternalOperationExecution(null, () -> false, dependency -> { }, System::nanoTime);
    }

    /** Each invocation counts one existing external Port call, not SDK wire-level retries. */
    public static void externalCall(String dependency) {
        observeCall(dependency).run();
    }

    /** Carry just this observation into parallel speech work, whose executor is joined before close. */
    public static Runnable observeCall(String dependency) {
        ExternalOperationExecution current = CURRENT.get();
        return current == null ? () -> { } : () -> current.call(dependency);
    }

    private synchronized void call(String dependency) {
        if (!attempted) {
            attempted = true;
            if (start.getAsBoolean()) {
                startedAt = nanoTime.get();
            }
        }
        if (startedAt != null) {
            onCall.accept(dependency);
        }
    }

    public static Long elapsedNanos(UUID operationId) {
        ExternalOperationExecution current = CURRENT.get();
        if (current == null || current.startedAt == null || !operationId.equals(current.operationId)) {
            return null;
        }
        Long now = current.nanoTime.get();
        return now == null ? null : Math.max(0, now - current.startedAt);
    }

    @Override
    public void close() {
        if (previous == null) {
            CURRENT.remove();
        } else {
            CURRENT.set(previous);
        }
    }
}
