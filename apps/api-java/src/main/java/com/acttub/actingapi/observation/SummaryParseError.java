package com.acttub.actingapi.observation;

public class SummaryParseError extends RuntimeException {
    public SummaryParseError(String message) {
        super(message);
    }

    public SummaryParseError(String message, Throwable cause) {
        super(message, cause);
    }
}
