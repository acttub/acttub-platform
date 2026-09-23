package com.acttub.actingapi.feature.challenge.domain;

import java.util.List;
import java.util.Locale;

/**
 * AI 리포트의 규칙 (challenge.ai-report, ADR-005 개정). 리포트는 관찰과 표현 차이의 설명이고 점수·백분위·등급·순위·
 * 칭찬·재능·합격 판정을 내지 않는다. 그런 말이 든 출력은 저장하지 않고 다시 만든다.
 */
public final class ChallengeReportRules {
    public static final int DAILY_REQUESTS = 3;
    /** 한 생성 안의 실행(자동 재시도 + 금지 어휘 재생성) 상한. 소진하면 failed 다. */
    public static final int MAX_RUNS = 3;
    public static final int MAX_SAMPLES = 5;
    /** 이보다 적으면 견주기 없이 관찰만 만든다. */
    public static final int MIN_SAMPLES = 3;
    public static final String TOO_FEW_SAMPLES = "비교할 영상이 아직 부족해요";
    public static final int FORMAT_VERSION = 1;

    /**
     * 채점·우열·칭찬·재능 판정의 말. 부분 일치로 본다(띄어쓰기·대소문자 무시). "확인하지 못했다"처럼 한계를 적는 말은
     * 걸리지 않게 둔다.
     */
    static final List<String> FORBIDDEN = List.of(
            "점수", "점 만점", "백분위", "퍼센타일", "등급", "순위", "등수", "상위", "하위", "1위", "꼴찌",
            "잘했", "잘하셨", "훌륭", "완벽", "뛰어나", "우수", "서툴", "재능", "소질", "타고난",
            "합격", "불합격", "score", "percentile", "grade", "rank");

    private ChallengeReportRules() { }

    /** 금지 어휘가 하나라도 들었으면 그 말을, 없으면 {@code null}. */
    public static String forbiddenWord(String text) {
        if (text == null) return null;
        String compact = text.toLowerCase(Locale.ROOT).replaceAll("\\s+", "");
        for (String word : FORBIDDEN) {
            if (compact.contains(word.toLowerCase(Locale.ROOT).replaceAll("\\s+", ""))) return word;
        }
        return null;
    }
}
