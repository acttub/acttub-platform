package com.acttub.actingapi.web;

/**
 * 파이썬 문자열 의미를 그대로 재현하는 텍스트 유틸.
 *
 * <p>{@code String.strip()} 은 파이썬 {@code str.strip()} 과 <b>다르다.</b> 자바는
 * {@link Character#isWhitespace(int)} 를 쓰는데 그 판정은 non-breaking space(U+00A0)를
 * <b>공백으로 보지 않는다.</b> 파이썬은 {@code str.isspace()} 기준이고 U+00A0 는 참이다(실측).
 *
 * <p>그래서 NBSP 만으로 이루어진 제목·본문·닉네임이 파이썬에서는 빈 문자열이 되어 422 가 나지만
 * 자바에서는 그대로 통과해 201 이 된다. 눈에 보이지 않는 차이라 응답을 눈으로 비교해도 드러나지
 * 않는다 — `community.py:_trimmed` 와 `profile.py:UpdateMeRequest` 양쪽에 적용된다.
 */
public final class PythonText {

    private PythonText() {
    }

    /** 파이썬 {@code str.strip()} 과 같은 기준으로 앞뒤 공백을 제거한다. */
    public static String strip(String value) {
        if (value == null) {
            return null;
        }
        int start = 0;
        int end = value.length();
        while (start < end && isPythonSpace(value.charAt(start))) {
            start++;
        }
        while (end > start && isPythonSpace(value.charAt(end - 1))) {
            end--;
        }
        return value.substring(start, end);
    }

    /** 파이썬 {@code str.rstrip()} 과 같은 기준으로 뒤쪽 공백만 제거한다. */
    public static String rstrip(String value) {
        if (value == null) {
            return null;
        }
        int end = value.length();
        while (end > 0 && isPythonSpace(value.charAt(end - 1))) {
            end--;
        }
        return value.substring(0, end);
    }

    /** U+0085 NEXT LINE. 파이썬은 공백으로 보지만 자바의 두 판정 어디에도 걸리지 않는다. */
    private static final char NEXT_LINE = '';

    /**
     * 파이썬 {@code str.isspace()} 대응.
     *
     * <p>{@link Character#isWhitespace(char)} 는 제어 공백(\t\n\r 등)을 잡고
     * {@link Character#isSpaceChar(char)} 는 유니코드 공백 범주(Zs·Zl·Zp)를 잡는다. NBSP 는
     * 후자에만 걸리므로 둘의 합집합이라야 파이썬에 가까워지는데, {@link #NEXT_LINE} 은
     * <b>둘 다 놓친다</b> — 파이썬에서는 참이다(실측). 그래서 따로 더한다.
     */
    public static boolean isPythonSpace(char character) {
        return Character.isWhitespace(character)
                || Character.isSpaceChar(character)
                || character == NEXT_LINE;
    }
}
