package com.acttub.actingapi.auth.domain;

import java.util.Locale;

/**
 * 프로바이더가 준 이메일을 계정에 붙일 수 있는 형태로 맞추는 규칙.
 *
 * <p>빈 것과 없는 것을 하나로 본다 — 프로바이더는 이메일을 주지 않기도 하고 빈 문자열로
 * 주기도 하는데, 그 둘이 갈리면 빈 문자열을 가진 계정이 생겨 <b>다음 로그인에서 서로 다른
 * 사람이 같은 계정으로 묶인다.</b>
 */
public final class EmailAddress {

    private EmailAddress() {
    }

    /** 앞뒤를 떼고 소문자로 맞춘다. 남는 것이 없으면 {@code null} — "이메일이 없다"와 같다. */
    public static String normalize(String raw) {
        if (raw == null) {
            return null;
        }
        String value = raw.strip().toLowerCase(Locale.ROOT);
        return value.isEmpty() ? null : value;
    }
}
