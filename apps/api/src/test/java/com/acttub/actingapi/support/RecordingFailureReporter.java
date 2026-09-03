package com.acttub.actingapi.support;

import java.util.ArrayList;
import java.util.List;

import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;

public final class RecordingFailureReporter implements FailureReporter {
    private final List<Report> reports = new ArrayList<>();

    @Override
    public void report(Throwable failure, FailureKind kind, FailureContext context) {
        reports.add(new Report(failure, kind, context.tagValue()));
    }

    public List<Report> reports() {
        return List.copyOf(reports);
    }

    public record Report(Throwable failure, FailureKind kind, String context) {
    }
}
