package com.acttub.actingapi.platform.observability;

public interface FailureReporter {

    void report(Throwable failure, FailureKind kind, String context);

    default void report(Throwable failure, String context) {
        report(failure, FailureKind.UNEXPECTED, context);
    }
}
