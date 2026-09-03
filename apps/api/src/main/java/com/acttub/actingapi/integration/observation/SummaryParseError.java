package com.acttub.actingapi.integration.observation;

import com.acttub.actingapi.platform.observability.ExternalFailure;

public class SummaryParseError extends RuntimeException implements ExternalFailure {
    public SummaryParseError(String message) {
        super(message);
    }

    public SummaryParseError(String message, Throwable cause) {
        super(message, cause);
    }
}
