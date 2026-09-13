package com.acttub.actingapi.platform.ledger;

import com.acttub.actingapi.platform.observability.FailureClassifier;
import com.acttub.actingapi.platform.web.ApiException;

/** Stored monitoring metadata; null means the cause was not observed. */
public final class ExternalOperationFailureClassification {
    public static final String EXPECTED = "expected";

    private ExternalOperationFailureClassification() {
    }

    public static String from(Throwable failure) {
        if (failure instanceof ApiException api) {
            return api.failureKind().map(kind -> kind.tagValue()).orElse(EXPECTED);
        }
        return failure == null ? null : FailureClassifier.classify(failure).tagValue();
    }
}
