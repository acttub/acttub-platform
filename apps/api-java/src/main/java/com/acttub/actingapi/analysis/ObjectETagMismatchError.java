package com.acttub.actingapi.analysis;

public class ObjectETagMismatchError extends RuntimeException {
    public ObjectETagMismatchError(String message) {
        super(message);
    }
}
