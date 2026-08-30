package com.acttub.actingapi.feature.practice.domain;

import java.util.List;

/**
 * 대화를 마친 배우가 "처음 막혔던 지점, 지금은?" 에 고른 답 (SOMA-466).
 *
 * <p>서버가 좋아졌는지를 판정하지 않는다 — 배우가 답하고 서버는 그대로 남긴다. 그래서
 * 보이는 말도 판정 어휘가 아니라 배우 상태의 표현이다(풀렸다 · 조금 풀렸다 · 그대로).
 * 허용값은 {@code practice_sessions.resolution_self_report} 의 CHECK 제약과 같다.
 */
public enum ResolutionSelfReport {
    RESOLVED("resolved", "풀렸다"),
    PARTLY("partly", "조금 풀렸다"),
    SAME("same", "그대로");

    public static final List<String> VALUES = List.of("resolved", "partly", "same");

    private final String value;
    private final String label;

    ResolutionSelfReport(String value, String label) {
        this.value = value;
        this.label = label;
    }

    /** 저장·전송에 쓰는 값. */
    public String value() {
        return value;
    }

    /** 배우에게 보이는 말. */
    public String label() {
        return label;
    }

    /** 허용값이 아니면 {@code null}. 어떤 오류로 옮길지는 부르는 쪽이 정한다. */
    public static ResolutionSelfReport parse(String value) {
        for (ResolutionSelfReport report : values()) {
            if (report.value.equals(value)) {
                return report;
            }
        }
        return null;
    }

    public static String labelOf(String value) {
        ResolutionSelfReport report = parse(value);
        return report == null ? null : report.label;
    }
}
