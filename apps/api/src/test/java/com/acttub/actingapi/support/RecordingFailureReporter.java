package com.acttub.actingapi.support;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import com.acttub.actingapi.platform.observability.FailureContext;
import com.acttub.actingapi.platform.observability.FailureKind;
import com.acttub.actingapi.platform.observability.FailureReporter;

/**
 * 보고를 메모리에 모으는 가짜. 보고는 테스트 스레드 밖에서도 온다 — {@code MonitoringFailures} 의 가상 스레드, 스케줄러, 요청 스레드.
 * 테스트 스레드가 그동안 {@link #contexts()} 를 읽으므로 동시에 써도 되는 목록에 담는다(일반 목록은
 * {@code ConcurrentModificationException} 을 냈다).
 */
public final class RecordingFailureReporter implements FailureReporter {
    private final List<Report> reports = new CopyOnWriteArrayList<>();

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
