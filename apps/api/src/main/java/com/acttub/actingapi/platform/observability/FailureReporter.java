package com.acttub.actingapi.platform.observability;

public interface FailureReporter {

    void report(Throwable failure, FailureKind kind, FailureContext context);

    default void report(Throwable failure, FailureContext context) {
        report(failure, FailureClassifier.classify(failure), context);
    }
}
