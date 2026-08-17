package com.acttub.actingapi.feature.report.domain;

/**
 * 성적표의 갈래와 그 갈래가 정하는 것들.
 *
 * <p>연습의 막힌 지점이 <b>분석</b>이냐 <b>표현</b>이냐로 갈리고, 그에 따라 모델에게 줄 프롬프트와
 * 만들어 낼 성적표의 모양이 통째로 달라진다. 갈래가 코드 곳곳에서 문자열로 비교되던 것을 여기
 * 한자리에 모은다.
 *
 * <p><b>열거형이 아니라 문자열 판정이다.</b> 이 값은 DB 컬럼({@code branch_kind})과 응답 필드
 * ({@code report_type})로 그대로 나가고, 모르는 값이 들어왔을 때 무엇을 하는지가 부르는 자리마다
 * 다르다 — 차단 노트는 모르는 값을 분석으로 취급하고, 모델 입력 조립은 예외를 던진다. 열거형으로
 * 바꾸면 그 차이가 한 곳에서 뭉개진다.
 */
public final class ReportBranch {

    /** 분석 갈래. 대사·상황을 어떻게 읽었는지가 막힌 자리다. */
    public static final String ANALYSIS = "analysis";

    /** 표현 갈래. 읽기는 됐는데 몸으로 나오지 않는 자리다. */
    public static final String EXPRESSION = "expression";

    /** 성적표를 만들지 않기로 한 상태. 갈래가 아니라 결과의 한 종류다. */
    public static final String BLOCKED = "blocked";

    private static final String BLOCKED_ANALYSIS_REASON = "confirmed_analysis_handoff_required";
    private static final String BLOCKED_EXPRESSION_REASON = "confirmed_expression_handoff_required";

    private ReportBranch() {
    }

    public static boolean isExpression(String reportType) {
        return EXPRESSION.equals(reportType);
    }

    public static boolean isAnalysis(String reportType) {
        return ANALYSIS.equals(reportType);
    }

    public static boolean isBlocked(String reportType) {
        return BLOCKED.equals(reportType);
    }

    /**
     * 이 갈래로 성적표를 만들지 못했을 때 남길 사유.
     *
     * <p>표현이 아닌 것은 전부 분석 사유를 받는다 — 갈래가 둘뿐이므로 모르는 값이 오면 분석으로
     * 보는 것이 종전 동작이고, 여기서 예외를 던지면 차단 노트를 내야 할 자리가 500이 된다.
     */
    public static String blockedReason(String reportType) {
        return isExpression(reportType) ? BLOCKED_EXPRESSION_REASON : BLOCKED_ANALYSIS_REASON;
    }

    /** 차단 노트가 실을 수 있는 사유인지. */
    public static boolean isKnownBlockedReason(String reason) {
        return BLOCKED_ANALYSIS_REASON.equals(reason) || BLOCKED_EXPRESSION_REASON.equals(reason);
    }
}
