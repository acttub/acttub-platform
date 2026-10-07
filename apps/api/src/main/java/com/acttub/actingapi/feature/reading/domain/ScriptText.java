package com.acttub.actingapi.feature.reading.domain;

import java.text.Normalizer;
import java.util.regex.Pattern;

import com.acttub.actingapi.platform.web.Hashing;

/**
 * 대본 글의 「같음」 (reading.script 「같은 글」). 같은 사람이 같은 글을 다시 넣으면 LLM 을 부르지 않고, 예시 대본과 같은
 * 글이면 미리 나눈 결과를 쓴다. 두 판정이 같은 정리를 써야 하므로 여기 한 곳이다.
 *
 * <p>정리는 NFC(맥에서 복사한 한글은 NFD 로 온다) → 보이지 않는 U+0000·U+200B·U+FEFF 제거 → 공백류 연속을 공백 하나로 → 앞뒤
 * 공백 제거다. 비슷한 글 찾기가 아니라 정리 뒤 <b>완전히 같음</b>이다. V33 이 기존 대본의 해시를 같은 식의 SQL 로
 * 채웠고, 두 식이 같은지는 {@code ReadingSchemaMigrationTest} 가 본다.
 */
public final class ScriptText {
    /** U+0000 은 PDF 추출기(pdf.js·PDFBox)가 매핑 없는 글자로 내는 것이고 Postgres text 는 담지 못한다(22021). */
    private static final Pattern INVISIBLE = Pattern.compile("[\\u0000\\u200B\\uFEFF]");
    /** Java 의 {@code \s} 도 Postgres 의 {@code \s} 도 쓰지 않는다 — 양쪽이 같은 목록을 보게. */
    private static final Pattern SPACES = Pattern.compile(
            "[\\u0009-\\u000D\\u0020\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000]+");

    private ScriptText() {
    }

    public static String normalized(String raw) {
        String nfc = Normalizer.normalize(raw == null ? "" : raw, Normalizer.Form.NFC);
        String collapsed = SPACES.matcher(INVISIBLE.matcher(nfc).replaceAll("")).replaceAll(" ");
        // 공백류는 이미 ' ' 하나로 접혔다. String.strip() 은 U+001C~U+001F 같은 제어 문자도 떼어 SQL 의 btrim(…, ' ') 과 어긋난다.
        int start = 0;
        int end = collapsed.length();
        while (start < end && collapsed.charAt(start) == ' ') start++;
        while (end > start && collapsed.charAt(end - 1) == ' ') end--;
        return collapsed.substring(start, end);
    }

    /** 보이지 않는 글자(U+0000·U+200B·U+FEFF)를 뺀 글. 저장되는 대사·지문·제목에 줄 앞의 보이지 않는 글자가 남지 않게. */
    public static String visible(String text) {
        return INVISIBLE.matcher(text).replaceAll("");
    }

    /** 정리한 글의 SHA-256(소문자 16진수 64자). {@code scripts.raw_hash}·{@code script_imports.raw_hash} 의 값. */
    public static String hash(String raw) {
        return Hashing.sha256Hex(normalized(raw));
    }
}
