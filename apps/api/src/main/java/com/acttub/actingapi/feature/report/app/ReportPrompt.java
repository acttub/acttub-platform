package com.acttub.actingapi.feature.report.app;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

import com.acttub.actingapi.platform.observability.LlmPrompt;

public final class ReportPrompt {

    private static final String ANALYSIS = load("/report/report-analysis-prompt.txt");
    private static final String EXPRESSION = load("/report/report-expression-prompt.txt");

    private ReportPrompt() {
    }

    public static String select(String reportType) {
        return "expression".equals(reportType) ? EXPRESSION : ANALYSIS;
    }

    /** 기록에 잇는 고정 본문. 이름은 프롬프트 갈래로만 정해 바깥에서 온 값이 프롬프트 이름을 늘리지 못하게 한다. */
    static LlmPrompt template(String reportType) {
        return "expression".equals(reportType)
                ? new LlmPrompt("report.expression", EXPRESSION) : new LlmPrompt("report.analysis", ANALYSIS);
    }

    private static String load(String resource) {
        try (InputStream input = ReportPrompt.class.getResourceAsStream(resource)) {
            if (input == null) {
                throw new IllegalStateException("report prompt is missing: " + resource);
            }
            String value = new String(input.readAllBytes(), StandardCharsets.UTF_8);
            return value.endsWith("\n") ? value.substring(0, value.length() - 1) : value;
        } catch (IOException exception) {
            throw new IllegalStateException("failed to read report prompt: " + resource, exception);
        }
    }
}
