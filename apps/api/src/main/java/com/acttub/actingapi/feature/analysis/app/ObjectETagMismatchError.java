package com.acttub.actingapi.feature.analysis.app;

import com.acttub.actingapi.platform.observability.ExternalFailure;

public class ObjectETagMismatchError extends RuntimeException implements ExternalFailure {
    public ObjectETagMismatchError(String message) {
        super(message);
    }
}
