package com.acttub.actingapi.platform.harness;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import com.acttub.actingapi.integration.llm.GeneratedText;
import com.acttub.actingapi.integration.llm.TextGenerator;
import com.acttub.actingapi.integration.llm.TokenUsage;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Component;

/** contract fixture의 coach/report 생성기와 결정적 blocking gate. */
@Component
@Primary
@Profile("contract")
public class ContractTextGenerator implements TextGenerator {
    static final String BLOCK_MARKER = "[[stub:block]]";
    static final long BLOCK_TIMEOUT_SECONDS = 20L;

    private final ObjectMapper mapper;
    private final JsonNode root;
    private final String analysisReportPrompt;
    private final String expressionReportPrompt;
    private final Stub coach;
    private final Stub report;

    public ContractTextGenerator(
            ObjectMapper mapper,
            @Value("${contract.llm-fixture}") String fixturePath) {
        this.mapper = mapper;
        try {
            this.root = mapper.readTree(Path.of(fixturePath).toFile());
        } catch (IOException exception) {
            throw new IllegalStateException(
                    "cannot read contract LLM fixture: " + Path.of(fixturePath).toAbsolutePath(),
                    exception);
        }
        this.analysisReportPrompt = resource("/report/report-analysis-prompt.txt");
        this.expressionReportPrompt = resource("/report/report-expression-prompt.txt");
        this.coach = new Stub(root.path("coach"));
        this.report = new Stub(root.path("report"));
    }

    @Override
    public GeneratedText generate(String instructions, String input) {
        Stub selected = instructions.equals(analysisReportPrompt)
                || instructions.equals(expressionReportPrompt)
                ? report
                : coach;
        return new GeneratedText(selected.generate(input), new TokenUsage(0, 0, 0));
    }

    public void release(String name) {
        stub(name).release();
    }

    public void rearm(String name) {
        stub(name).rearm();
    }

    public Map<String, Object> coachState() {
        return coach.state();
    }

    public Map<String, Object> reportState() {
        return report.state();
    }

    /**
     * 스텁 카운터를 0 으로 되돌린다.
     *
     * <p>파이썬 백엔드는 시나리오마다 앱을 새로 만들어 스텁도 새로 생기지만, java 는 한
     * 프로세스가 전 시나리오를 받는다. 리셋하지 않으면 호출 수가 누적돼 <b>스텁 호출
     * 예산(budget)과 `calls` 비교가 전부 어긋난다.</b>
     */
    public void reset() {
        coach.reset();
        report.reset();
    }

    private Stub stub(String name) {
        return switch (name) {
            case "coach_generate" -> coach;
            case "report_generate" -> report;
            default -> throw new IllegalArgumentException("unknown gated stub: " + name);
        };
    }

    private String responseText(JsonNode selected) {
        JsonNode resolved = resolve(selected);
        if (resolved.isTextual()) {
            return resolved.textValue();
        }
        try {
            return mapper.writeValueAsString(resolved);
        } catch (IOException exception) {
            throw new IllegalStateException("contract LLM response is not serializable", exception);
        }
    }

    private JsonNode resolve(JsonNode value) {
        if (value.isTextual() && "$analysis_handoff".equals(value.textValue())) {
            return root.path("analysis_handoff").deepCopy();
        }
        if (value.isObject()) {
            ObjectNode copy = mapper.createObjectNode();
            value.fields().forEachRemaining(entry -> copy.set(entry.getKey(), resolve(entry.getValue())));
            return copy;
        }
        if (value.isArray()) {
            ArrayNode copy = mapper.createArrayNode();
            value.forEach(item -> copy.add(resolve(item)));
            return copy;
        }
        return value.deepCopy();
    }

    private static String resource(String path) {
        try (InputStream input = ContractTextGenerator.class.getResourceAsStream(path)) {
            if (input == null) {
                throw new IllegalStateException("missing prompt resource: " + path);
            }
            String value = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            return value.endsWith("\n") ? value.substring(0, value.length() - 1) : value;
        } catch (IOException exception) {
            throw new IllegalStateException("cannot read prompt resource: " + path, exception);
        }
    }

    private final class Stub {
        private final JsonNode spec;
        private final Object monitor = new Object();
        private final AtomicInteger calls = new AtomicInteger();
        private int blocked;
        private int inBlockCount;
        private int timedOut;
        private boolean released;

        private Stub(JsonNode spec) {
            this.spec = spec;
        }

        private void reset() {
            synchronized (monitor) {
                calls.set(0);
                blocked = 0;
                inBlockCount = 0;
                timedOut = 0;
                released = false;
                monitor.notifyAll();
            }
        }

        private String generate(String prompt) {
            calls.incrementAndGet();
            if (prompt.contains(BLOCK_MARKER)) {
                block();
            }
            JsonNode selected = spec.path("default");
            Iterator<Map.Entry<String, JsonNode>> markers = spec.path("by_marker").fields();
            while (markers.hasNext()) {
                Map.Entry<String, JsonNode> marker = markers.next();
                if (prompt.contains(marker.getKey())) {
                    selected = marker.getValue();
                    break;
                }
            }
            return responseText(selected);
        }

        private void block() {
            long deadline = System.nanoTime()
                    + TimeUnit.SECONDS.toNanos(BLOCK_TIMEOUT_SECONDS);
            synchronized (monitor) {
                blocked++;
                inBlockCount++;
                monitor.notifyAll();
                try {
                    while (!released) {
                        long remaining = deadline - System.nanoTime();
                        if (remaining <= 0) {
                            timedOut++;
                            break;
                        }
                        TimeUnit.NANOSECONDS.timedWait(monitor, remaining);
                    }
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    timedOut++;
                } finally {
                    inBlockCount--;
                    monitor.notifyAll();
                }
            }
        }

        private void release() {
            synchronized (monitor) {
                released = true;
                monitor.notifyAll();
            }
        }

        private void rearm() {
            synchronized (monitor) {
                released = false;
            }
        }

        private Map<String, Object> state() {
            synchronized (monitor) {
                int budget = spec.path("budget").asInt(0);
                int callCount = calls.get();
                Map<String, Object> state = new LinkedHashMap<>();
                state.put("calls", callCount);
                state.put("remaining", Math.max(0, budget - callCount));
                state.put("budget", budget);
                state.put("blocked", blocked);
                state.put("in_block", inBlockCount > 0);
                state.put("in_block_count", inBlockCount);
                state.put("timed_out", timedOut);
                return state;
            }
        }
    }
}
