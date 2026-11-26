package com.acttub.actingapi.feature.practice.domain;

/**
 * 회차의 단계({@code practices.stage})가 넘어가는 길 전부. 정본은 docs/specs/practice/start.md 「상태」다.
 *
 * <p>여기에 없는 길로 단계를 바꾸는 문장은 없다. 단계를 바꾸는 UPDATE 는 {@code PostgresPracticeStageTransitions} 한 파일에만
 * 있고, 그 문장들이 이 표와 맞는지 {@code StateTransitionTest} 가 본다. 회차를 만들 때의 첫 단계({@code analyzing}, 영상 없이
 * 시작하면 {@code conversing})는 전이가 아니라 여기 없다.
 */
public enum PracticeStageTransition {
    /** 분석 결과가 저장됐다. */
    ANALYSIS_SAVED("analyzing", "conversing", null),
    /** 분석이 바로 실패했거나 세 번을 다 썼다. */
    ANALYSIS_FAILED("analyzing", "closed", "analysis_failed"),
    /** 배우가 대기·진행 중인 분석을 그만뒀다. */
    CANCELLED("analyzing", "closed", "cancelled"),
    /** 코치 대화가 닫혔다. */
    CONVERSATION_CLOSED("conversing", "closed", "conversation_closed"),
    /** 닫힌 대화를 다시 열었다. 닫힌 회차를 대화로 되살리는 길은 이것 하나다. */
    CONVERSATION_REOPENED("closed", "conversing", null),
    /** 분석이 닫았거나 그만둔 회차를 다시 분석한다. */
    RETRIED("closed", "analyzing", null);

    private final String from;
    private final String to;
    private final String closeReason;

    PracticeStageTransition(String from, String to, String closeReason) {
        this.from = from;
        this.to = to;
        this.closeReason = closeReason;
    }

    public String from() {
        return from;
    }

    public String to() {
        return to;
    }

    /** 닫힐 때 적는 사유. 닫히지 않는 전이는 {@code null} 이고 사유를 비운다. */
    public String closeReason() {
        return closeReason;
    }
}
