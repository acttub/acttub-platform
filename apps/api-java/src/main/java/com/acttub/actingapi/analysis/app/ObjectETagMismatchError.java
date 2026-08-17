package com.acttub.actingapi.analysis.app;

public class ObjectETagMismatchError extends RuntimeException {
    public ObjectETagMismatchError(String message) {
        super(message);
    }
}
