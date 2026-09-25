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

    /** 보고된 자리들. 무엇이 보고됐는지만 볼 때 쓴다. */
    public List<String> contexts() {
        return reports.stream().map(Report::context).toList();
    }

    /** 컨텍스트에 하나뿐인 빈으로 쓸 때 테스트 사이에 비운다. */
    public void clear() {
        reports.clear();
    }

    public record Report(Throwable failure, FailureKind kind, String context) {
    }
}
