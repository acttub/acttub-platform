package com.acttub.actingapi.platform.ledger;

import java.util.UUID;
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;
import java.util.function.Supplier;

/**
 * A synchronous execution scope: no UUID becomes a metric label and no completed scope is retained.
 *
 * <p>이 범위로 실행 시도·외부 호출을 세던 옛 큐 지표는 SOMA-1140 에서 지웠다. 지금은 {@link #unobserved()} 만 있어 아무것도
 * 기록하지 않는다. 코치·리포트·분석의 {@code externalCall}·{@code observeCall} 호출과 이 클래스는 후속에서 걷어 낸다.
 */
public final class ExternalOperationExecution implements AutoCloseable {
    private static final ThreadLocal<ExternalOperationExecution> CURRENT = new ThreadLocal<>();
    private final UUID operationId;
    private final BooleanSupplier start;
    private final Consumer<String> onCall;
    private final Supplier<Long> nanoTime;
    private final ExternalOperationExecution previous;
    private Long startedAt;
    private boolean attempted;

    private ExternalOperationExecution(UUID operationId, BooleanSupplier start, Consumer<String> onCall, Supplier<Long> nanoTime) {
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

    @Override
    public void close() {
        if (previous == null) {
            CURRENT.remove();
        } else {
            CURRENT.set(previous);
        }
    }
}
