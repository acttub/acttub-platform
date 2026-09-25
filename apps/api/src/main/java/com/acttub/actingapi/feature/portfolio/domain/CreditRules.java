package com.acttub.actingapi.feature.portfolio.domain;

import java.time.LocalDate;

/** 포트폴리오의 상한 (account.portfolio, 결정 13). */
public final class CreditRules {

    /** 소개글의 길이. 글자(code point)로 센다. */
    public static final int INTRO_MAX = 2000;

    /** 작품명과 역할의 길이. */
    public static final int TEXT_MAX = 100;

    public static final int CREDIT_MAX = 50;
    public static final int PHOTO_MAX = 10;
    public static final int YEAR_MIN = 1900;

    private CreditRules() {
    }

    /** 연도는 1900년부터 <b>내년</b>까지다 — 촬영이 끝났고 내년에 개봉하는 작품을 적을 수 있다. */
    public static boolean yearAllowed(int year, LocalDate today) {
        return year >= YEAR_MIN && year <= today.getYear() + 1;
    }

    public static int length(String text) {
        return text.codePointCount(0, text.length());
    }
}
