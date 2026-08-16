package com.acttub.actingapi.report.app;

public class ReportParseError extends RuntimeException {
    public ReportParseError(String message) {
        super(message);
    }

    public ReportParseError(String message, Throwable cause) {
        super(message, cause);
    }
}
