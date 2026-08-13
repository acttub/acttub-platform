package com.acttub.actingapi.harness;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.analysis.AnalysisContext;
import com.acttub.actingapi.analysis.AnalysisProcessor;
import com.acttub.actingapi.analysis.AnalysisResult;
import com.acttub.actingapi.analysis.UnsupportedMediaError;
import com.acttub.actingapi.summary.FileActiveTimeout;
import com.acttub.actingapi.summary.ObservationPack;
import com.acttub.actingapi.summary.SummaryParseError;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** contract 프로파일에서는 영상 바이트를 해석하지 않고 fixture 결과를 반환한다. */
@Component
@Primary
@Profile("contract")
public class ContractAnalysisProcessor implements AnalysisProcessor {
    private static final Map<String, String> MARKERS = Map.of(
            "[[analyze:timeout]]", "timeout",
            "[[analyze:parse]]", "parse",
            "[[analyze:unsupported]]", "unsupported",
            "[[analyze:transient]]", "transient");
    private static final String FAIL_ONCE = "[[analyze:failonce]]";

    private final ObservationPack observationPack;
    private final List<String> transcripts;
    private final AtomicInteger calls = new AtomicInteger();
    private final Set<String> failedOnce = ConcurrentHashMap.newKeySet();

    public ContractAnalysisProcessor(
            ObjectMapper mapper,
            @Value("${contract.llm-fixture}") String fixturePath) {
        try {
            JsonNode fixture = mapper.readTree(Path.of(fixturePath).toFile());
            this.observationPack = mapper.treeToValue(
                    fixture.path("observation_pack"), ObservationPack.class);
            this.transcripts = mapper.convertValue(
                    fixture.path("transcripts"),
                    mapper.getTypeFactory().constructCollectionType(List.class, String.class));
        } catch (IOException exception) {
            throw new IllegalStateException("cannot read contract analyzer fixture", exception);
        }
    }

    @Override
    public AnalysisResult analyze(Path videoPath, AnalysisContext context) {
        calls.incrementAndGet();
        String haystack = String.join(" ",
                value(context.situation()),
                value(context.characterContext()),
                value(context.goal()),
                value(context.blockageDetail()));
        String identity = String.valueOf(context.sessionId());
        if (haystack.contains(FAIL_ONCE) && failedOnce.add(identity)) {
            raise("timeout");
        }
        for (Map.Entry<String, String> marker : MARKERS.entrySet()) {
            if (haystack.contains(marker.getKey())) {
                raise(marker.getValue());
            }
        }
        return new AnalysisResult(
                observationPack,
                false,
                "분석".equals(context.blockageKind()) ? transcripts : List.of());
    }

    public Map<String, Object> state() {
        return Map.of("calls", calls.get());
    }

    /** 시나리오 사이에 호출 수를 0 으로 되돌린다 (`ContractTextGenerator.reset` 참조). */
    public void reset() {
        calls.set(0);
    }

    private static String value(String value) {
        return value == null ? "" : value;
    }

    private static void raise(String behavior) {
        switch (behavior) {
            case "timeout" -> throw new FileActiveTimeout("harness: file active timeout");
            case "parse" -> throw new SummaryParseError("harness: summary parse error");
            case "unsupported" -> throw new UnsupportedMediaError("harness: unsupported media");
            default -> throw new RuntimeException("harness: transient analyzer failure");
        }
    }
}
