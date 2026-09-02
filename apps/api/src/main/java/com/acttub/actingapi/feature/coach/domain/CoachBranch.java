package com.acttub.actingapi.feature.coach.domain;

/**
 * 연습이 막힌 자리가 정하는 코칭·성적표의 갈래.
 *
 * <p>배우가 연습을 만들 때 고른 <b>막힌 지점</b>({@code blockage_kind})이 코칭 프롬프트와 성적표의
 * 모양을 통째로 정한다. "표현"이면 표현 갈래, 나머지는 전부 분석 갈래다 — 갈래가 둘뿐이라
 * 모르는 값을 분석으로 보는 것이 종전 동작이고, 여기서 예외를 던지면 대화를 시작하지 못한다.
 *
 * <p>⚠ <b>{@code report/domain/ReportBranch} 가 같은 두 값을 따로 갖는다.</b> 이 문자열은
 * {@code coaching_handoffs.branch_kind} 로 저장돼 성적표의 {@code report_type} 이 되므로, 둘이
 * 어긋나면 만들어진 성적표가 코칭과 다른 갈래가 된다. 합치지 않은 것은 도메인이 서로의
 * {@code domain} 층을 보지 않기 때문이다(ADR-019).
 */
public final class CoachBranch {

    /** 대사·상황을 어떻게 읽었는지가 막힌 자리. */
    public static final String ANALYSIS = "analysis";

    /** 읽기는 됐는데 몸으로 나오지 않는 자리. */
    public static final String EXPRESSION = "expression";

    /** 배우가 고르는 막힌 지점의 값. DB 에 한국어로 들어간다. */
    private static final String EXPRESSION_BLOCKAGE = "표현";

    /** 막힘 선택을 건너뛰면 웹·앱 모두가 보내는 중립값(ADR-021 보강). 갈래는 분석이다. */
    private static final String UNSPECIFIED_BLOCKAGE = "그 외";

    private CoachBranch() {
    }

    public static String of(String blockageKind) {
        return isExpressionBlockage(blockageKind) ? EXPRESSION : ANALYSIS;
    }

    /**
     * 표현으로 막힌 연습인지.
     *
     * <p>표현 갈래는 앞서 확정한 <b>분석 핸드오프</b>를 함께 읽어야 한다 — 무엇을 어떻게 읽었는지
     * 없이 표현만 보면 코치가 같은 이야기를 처음부터 다시 묻는다.
     */
    public static boolean isExpressionBlockage(String blockageKind) {
        return EXPRESSION_BLOCKAGE.equals(blockageKind);
    }

    /**
     * 막힌 지점을 고르지 않은 연습인지.
     *
     * <p>갈래는 분석이지만 코치가 막힘을 전제로 열면 안 되는 세션이다 — 코칭 프롬프트가 그 사실을
     * 따로 말한다. 하위 갈래의 {@code 그 외} 는 여기 해당하지 않는다(그 세션은 갈래를 고른 세션이다).
     */
    public static boolean isBlockageUnspecified(String blockageKind) {
        return UNSPECIFIED_BLOCKAGE.equals(blockageKind);
    }
}
