package com.acttub.actingapi.report;

/** Python 의 {@code LookupError("practice session not found")} 대응. */
public class PracticeSessionNotFoundException extends RuntimeException {

    public PracticeSessionNotFoundException(String message) {
        super(message);
    }
}
