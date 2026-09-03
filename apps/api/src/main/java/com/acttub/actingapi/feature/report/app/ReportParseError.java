package com.acttub.actingapi.feature.report.app;

import com.acttub.actingapi.platform.observability.ExternalFailure;

public class ReportParseError extends RuntimeException implements ExternalFailure {
    public ReportParseError(String message) {
        super(message);
    }

    public ReportParseError(String message, Throwable cause) {
        super(message, cause);
    }
}
