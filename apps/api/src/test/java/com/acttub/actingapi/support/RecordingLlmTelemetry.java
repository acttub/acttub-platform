package com.acttub.actingapi.support;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;

import com.acttub.actingapi.platform.observability.LlmCall;
import com.acttub.actingapi.platform.observability.LlmScore;
import com.acttub.actingapi.platform.observability.LlmStep;
import com.acttub.actingapi.platform.observability.LlmTelemetry;

/**
 * 시험용 관측기. 보내는 대신 담아 둔다 — {@code RecordingFailureReporter} 와 같은 꼴이다.
 *
 * <p>여러 스레드에서 부를 수 있으므로 담는 자리도 그에 맞춘다(분석은 가상 스레드 둘로
 * 나뉘어 돈다).
 */
public class RecordingLlmTelemetry implements LlmTelemetry {

    private final List<LlmCall> calls = new CopyOnWriteArrayList<>();
    private final List<LlmScore> scores = new CopyOnWriteArrayList<>();

    @Override
    public void record(LlmCall call) {
        calls.add(call);
    }

    @Override
    public void score(LlmScore score) {
        scores.add(score);
    }

    public List<LlmCall> calls() {
        return List.copyOf(calls);
    }

    public List<LlmScore> scores() {
        return List.copyOf(scores);
    }

    public List<LlmStep> steps() {
        return calls.stream().map(LlmCall::step).toList();
    }

    public List<String> scoreNames() {
        return scores.stream().map(LlmScore::name).toList();
    }
}
