package com.acttub.actingapi.feature.profile.domain;

import java.util.regex.Pattern;

/**
 * 가입을 끝낸 클라이언트 판 (SOMA-643). {@code X-Acttub-Client} 헤더 값(예: {@code app/0.1.4})만 짧게 걸러 둔다.
 * 모양이 다르거나 길면 버린다 — 요청의 다른 것은 아무것도 남기지 않는다.
 */
public final class SignupClient {

    public static final int MAX_LENGTH = 32;
    private static final Pattern SHAPE = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9._+-]*/[A-Za-z0-9][A-Za-z0-9._+-]*$");

    private SignupClient() {
    }

    /** 허용 모양이면 앞뒤 공백을 걷은 값, 아니면 {@code null}. */
    public static String of(String header) {
        if (header == null) {
            return null;
        }
        String value = header.strip();
        return value.length() <= MAX_LENGTH && SHAPE.matcher(value).matches() ? value : null;
    }
}
