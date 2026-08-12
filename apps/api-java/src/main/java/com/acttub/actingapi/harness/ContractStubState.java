package com.acttub.actingapi.harness;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.storage.ContractObjectStorage;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

@Component
@Profile("contract")
public class ContractStubState {
    private static final List<String> GATED = List.of("coach_generate", "report_generate");

    private final ContractTextGenerator text;
    private final ContractAnalysisProcessor analyzer;
    private final ContractObjectStorage storage;

    public ContractStubState(
            ContractTextGenerator text,
            ContractAnalysisProcessor analyzer,
            ObjectProvider<ContractObjectStorage> storage) {
        this.text = text;
        this.analyzer = analyzer;
        this.storage = storage.getIfAvailable();
    }

    /**
     * 스텁 관측 상태를 시나리오 시작 시점으로 되돌린다.
     *
     * <p>파이썬은 시나리오마다 앱을 새로 만들어 스텁도 새로 생기는데 java 는 한 프로세스가
     * 전 시나리오를 받는다. 이것이 없으면 호출 수가 누적돼 <b>`calls`·`remaining` 비교와
     * presign 기록이 전부 어긋난다</b> — 실제로 그렇게 어긋났다.
     */
    public void reset() {
        text.reset();
        analyzer.reset();
        if (storage != null) {
            storage.resetCallLog();
        }
    }

    public Map<String, Object> control(Map<String, Object> payload) {
        Object requested = payload.get("stub");
        List<String> targets;
        if (requested == null) {
            targets = GATED;
        } else if (GATED.contains(requested.toString())) {
            targets = List.of(requested.toString());
        } else {
            throw new IllegalArgumentException("unknown gated stub: " + requested);
        }
        for (String target : targets) {
            if (Boolean.TRUE.equals(payload.get("release"))) {
                text.release(target);
            }
            if (Boolean.TRUE.equals(payload.get("rearm"))) {
                text.rearm(target);
            }
        }
        Map<String, Object> state = new LinkedHashMap<>();
        state.put("coach_generate", text.coachState());
        state.put("report_generate", text.reportState());
        state.put("analyzer", analyzer.state());
        state.put("s3", storage == null ? Map.of("calls", Map.of(), "presign_calls", List.of())
                : storage.state());
        return state;
    }
}
