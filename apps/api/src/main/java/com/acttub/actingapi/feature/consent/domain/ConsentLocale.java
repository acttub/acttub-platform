package com.acttub.actingapi.feature.consent.domain;

import java.util.Locale;
import java.util.Set;

/**
 * 동의 문서가 쓰인 말 (SOMA-544).
 *
 * <p>한국어가 정본이다. 어느 판이 현행인지는 한국어 문서가 정하고, 다른 말은 <b>같은 판의
 * 번역본</b>으로만 존재한다. 번역본이 없으면 한국어를 보여준다 — 동의 화면이 비는 것보다 낫다.
 *
 * <p>아는 말만 받는다. 모르는 말이 오면 한국어로 본다 — 임의의 문자열이 조회 조건으로
 * 흘러들지 않게 하고, 값이 늘어날 때 번역본을 함께 올리도록 강제한다.
 */
public final class ConsentLocale {

    /** 정본. 모든 종류에 반드시 이 말의 문서가 있다. */
    public static final String CANONICAL = "ko";

    private static final Set<String> SUPPORTED = Set.of("ko", "en");

    private ConsentLocale() {}

    /** 요청한 말을 지원하는 값으로 좁힌다. 모르면 정본. */
    public static String of(Locale locale) {
        if (locale == null) return CANONICAL;
        return of(locale.getLanguage());
    }

    /** 말 코드를 지원하는 값으로 좁힌다. 모르면 정본. */
    public static String of(String language) {
        if (language == null || language.isBlank()) return CANONICAL;
        String lowered = language.toLowerCase(Locale.ROOT);
        return SUPPORTED.contains(lowered) ? lowered : CANONICAL;
    }

    public static boolean isSupported(String language) {
        return language != null && SUPPORTED.contains(language.toLowerCase(Locale.ROOT));
    }
}
