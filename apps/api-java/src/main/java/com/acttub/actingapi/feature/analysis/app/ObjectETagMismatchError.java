package com.acttub.actingapi.feature.analysis.app;

public class ObjectETagMismatchError extends RuntimeException {
    public ObjectETagMismatchError(String message) {
        super(message);
    }
}
