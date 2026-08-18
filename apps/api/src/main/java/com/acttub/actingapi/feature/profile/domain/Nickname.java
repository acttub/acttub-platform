package com.acttub.actingapi.feature.profile.domain;

import java.util.regex.Pattern;

import com.acttub.actingapi.platform.web.PythonText;

/**
 * 사용자가 보낸 닉네임과 그것에 걸리는 규칙.
 *
 * <p>거절하는 일(422 로 옮기는 것)은 여기가 아니라 web 어댑터가 한다 — 이 타입은 "무엇인가"만
 * 답한다. 응답 본문의 모양이 곧 계약이고, 그 계약은 요청을 받는 자리의 것이다.
 *
 * <p>📌 <b>길이는 원본으로 재고 저장은 정규화한 값으로 한다.</b> 파이썬이 pydantic 의
 * {@code min_length}·{@code max_length} 로 원본을 먼저 재고, 그 뒤 validator 가 공백을 접기
 * 때문이다 — 순서를 바꾸면 스무 자를 넘겨 보낸 공백투성이 입력이 통과한다.
 *
 * <p>🔎 {@code platform/web/PythonText} 를 보는 것은 의도한 것이다({@code memory/domain} 과
 * 같은 형태) — 파이썬 {@code str.strip} 의 공백 집합을 재현하는 문자열 규칙이라 정규화 규칙과
 * 같은 층에 속하고, 여기서 손으로 다시 구현하면 두 벌이 갈린다.
 */
public record Nickname(String raw) {

    /** 파이썬 {@code Field(max_length=20)} 와 같은 상한. 코드포인트로 센다. */
    public static final int MAX_LENGTH = 20;

    private static final Pattern INTERNAL_WHITESPACE =
            Pattern.compile("\\s+", Pattern.UNICODE_CHARACTER_CLASS);

    /** 코드포인트 개수. 서로게이트 페어(이모지)를 한 글자로 센다. */
    public int length() {
        return raw.codePointCount(0, raw.length());
    }

    public boolean tooShort() {
        return length() == 0;
    }

    public boolean tooLong() {
        return length() > MAX_LENGTH;
    }

    /** 내부 공백을 하나로 접고 앞뒤를 뗀 값. 전부 공백이었으면 빈 문자열이다. */
    public String normalized() {
        return PythonText.strip(INTERNAL_WHITESPACE.matcher(raw).replaceAll(" "));
    }

    /** 접고 나면 남는 것이 없는가. 길이 검사를 통과하고도 여기서 걸리는 입력이 있다. */
    public boolean blankAfterFolding() {
        return normalized().isEmpty();
    }
}
