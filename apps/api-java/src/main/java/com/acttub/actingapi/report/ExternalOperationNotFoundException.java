package com.acttub.actingapi.report;

/** Python 의 {@code LookupError("external operation not found")} 대응. */
public class ExternalOperationNotFoundException extends RuntimeException {

    public ExternalOperationNotFoundException(String message) {
        super(message);
    }
}
