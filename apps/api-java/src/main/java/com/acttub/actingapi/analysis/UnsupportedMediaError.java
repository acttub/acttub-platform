package com.acttub.actingapi.analysis;

public class UnsupportedMediaError extends RuntimeException {
    public UnsupportedMediaError(String message) {
        super(message);
    }

    public UnsupportedMediaError(String message, Throwable cause) {
        super(message, cause);
    }
}
