package com.acttub.actingapi.feature.reading.domain;

/**
 * 나누기 작업의 진행률(%) 구간 (reading.script 「나누기 작업」, SOMA-960). 줄 수만 세면 줄을 다 나눈 뒤의 단계(빠진 줄·줄 검토·마무리)
 * 동안 화면이 100% 에 멈춰 있었다. 구간 끝값은 2026-11-01 dev 실측의 시간 비율이다 — 5만 자·1,786줄 77초 중 준비 6초,
 * 줄 나누기 16초, 빠진 줄 4초, 줄 검토 42초, 마무리 9초.
 */
public final class ScriptSplitProgress {

    /** 띄어쓰기 복원 뒤. */
    public static final int SPACED = 5;

    /** 배역 목록을 받은 뒤(조각이 둘 이상일 때). 줄 나누기 구간이 여기서 시작한다. */
    public static final int PREPARED = 8;

    /** 줄을 다 나눈 뒤. */
    public static final int SPLIT = 30;

    /** 빠진 줄을 다시 물은 뒤. 줄 검토 구간이 여기서 시작한다. */
    public static final int FILLED = 35;

    /** 줄 검토가 끝난 뒤. */
    public static final int REVIEWED = 88;

    /** 같은 화자 합치기가 끝난 뒤. */
    public static final int MERGED = 94;

    /** 저장 직전. 100 은 저장이 끝난 작업만 갖는다. */
    public static final int SAVING = 99;

    private ScriptSplitProgress() {
    }

    /** {@code from}~{@code to} 구간에서 {@code total} 중 {@code done} 만큼 온 자리. 셀 것이 없으면 구간 끝이다. */
    public static int between(int from, int to, int done, int total) {
        if (total <= 0) {
            return to;
        }
        int clamped = Math.clamp(done, 0, total);
        return from + (int) ((long) (to - from) * clamped / total);
    }
}
