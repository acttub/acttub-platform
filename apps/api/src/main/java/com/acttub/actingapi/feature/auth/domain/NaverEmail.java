package com.acttub.actingapi.feature.auth.domain;

import java.util.Locale;

/**
 * 네이버가 준 이메일을 검증된 것으로 볼지.
 *
 * <p>네이버는 검증 표시를 주지 않는다. 주소가 {@code @naver.com} 이면 그 네이버 계정의 메일함이므로
 * 검증된 것으로 보고, 외부 메일(연락처 이메일을 바꾼 경우)이면 검증되지 않은 것으로 본다. 네이버가 준
 * 표시가 아니라 <b>계정 구조에 따른 우리 판단</b>이다 (account.login).
 */
public final class NaverEmail {
    private static final String OWN_DOMAIN = "@naver.com";

    private NaverEmail() {
    }

    /** @param email 정규화(공백 제거·소문자)를 거치지 않은 값도 받는다. 없으면 {@code false} */
    public static boolean verifiedByAccountStructure(String email) {
        if (email == null) {
            return false;
        }
        String normalized = email.strip().toLowerCase(Locale.ROOT);
        // 골뱅이가 하나뿐이고 그 앞에 아이디가 있어야 한다 — "x@evil.com@naver.com" 같은 값을 거른다.
        return normalized.endsWith(OWN_DOMAIN)
                && normalized.indexOf('@') == normalized.length() - OWN_DOMAIN.length()
                && normalized.length() > OWN_DOMAIN.length();
    }
}
