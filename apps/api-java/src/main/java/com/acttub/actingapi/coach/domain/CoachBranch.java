package com.acttub.actingapi.coach.domain;

/**
 * 연습이 막힌 자리가 정하는 코칭·성적표의 갈래.
 *
 * <p>배우가 연습을 만들 때 고른 <b>막힌 지점</b>({@code blockage_kind})이 코칭 프롬프트와 성적표의
 * 모양을 통째로 정한다. "표현"이면 표현 갈래, 나머지는 전부 분석 갈래다 — 갈래가 둘뿐이라
 * 모르는 값을 분석으로 보는 것이 종전 동작이고, 여기서 예외를 던지면 대화를 시작하지 못한다.
 */
public final class CoachBranch {

    /** 대사·상황을 어떻게 읽었는지가 막힌 자리. */
    public static final String ANALYSIS = "analysis";

    /** 읽기는 됐는데 몸으로 나오지 않는 자리. */
    public static final String EXPRESSION = "expression";

    /** 배우가 고르는 막힌 지점의 값. DB 에 한국어로 들어간다. */
    private static final String EXPRESSION_BLOCKAGE = "표현";

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
}
