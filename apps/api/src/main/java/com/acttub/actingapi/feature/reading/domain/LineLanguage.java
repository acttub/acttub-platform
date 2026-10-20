package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 대사 줄의 말 (reading.script 「줄별 말」, SOMA-751).
 *
 * <p>리딩의 상대역 목소리와 받아쓰기는 줄마다 말을 정한다. 한국어 대본 안에 아랍어·영어 대사가 섞인 대본이 있어서
 * 대본 하나에 말 하나로는 모자라다. 한글 말고 다른 글자가 든 대사만 모델에 물어 {@code 줄번호<TAB>말<TAB>소리 낼 글}
 * 을 받는다. 말은 앱 목소리(Supertonic 3)가 읽을 줄 아는 두 글자 코드만 받는다. 한국어 줄은 두 칸 모두 비워 둔다 —
 * 지금과 똑같이 읽힌다.
 */
public final class LineLanguage {

    /** 앱 목소리가 읽는 말(한국어 포함). 이 밖의 답은 버린다. */
    public static final Set<String> SUPPORTED = Set.of(
            "ko", "en", "ja", "ar", "bg", "cs", "da", "de", "el", "es", "et", "fi", "fr", "hi", "hr", "hu", "id", "it",
            "lt", "lv", "nl", "pl", "pt", "ro", "ru", "sk", "sl", "sv", "tr", "uk", "vi");

    public static final String KOREAN = "ko";

    /** 소리 낼 글의 상한(코드 포인트). 줄 글의 상한과 같다. */
    static final int SPEECH_MAX = 5000;

    /** 한글이 아닌 글자가 이만큼 있어야 묻는다. "OK" 하나 같은 줄까지 부르지 않으려는 것이다. */
    static final int FOREIGN_LETTERS = 3;

    private LineLanguage() {
    }

    /** 모델에 물을 줄인가 — 괄호 지시를 뺀 글에 한글이 아닌 글자가 {@link #FOREIGN_LETTERS} 개 이상이다. */
    public static boolean worthAsking(String text) {
        if (text == null) {
            return false;
        }
        String body = text.replaceAll("\\([^)]*\\)|\\[[^]]*]", " ");
        int foreign = 0;
        for (int i = 0; i < body.length(); ) {
            int c = body.codePointAt(i);
            i += Character.charCount(c);
            if (Character.isLetter(c) && Character.UnicodeScript.of(c) != Character.UnicodeScript.HANGUL) {
                foreign++;
                if (foreign >= FOREIGN_LETTERS) {
                    return true;
                }
            }
        }
        return false;
    }

    /** 한 줄의 답. 한국어면 {@code speech} 는 {@code null} 이다. */
    public record Result(String lang, String speech) {
    }

    /**
     * 한 줄에 서로 다른 말이 이어질 때(예: 「고맙습니다. shukran ktir.」) 소리 낼 글은 조각마다 이 표시를 앞에 붙여 잇는다 —
     * {@code ⟦ko⟧고맙습니다. ⟦ar⟧شكراً كتير.} 앱은 조각마다 그 말로 읽고, 서버의 대조는 표시를 지우고 견준다.
     */
    public static final String MARK_OPEN = "\u27E6";
    public static final String MARK_CLOSE = "\u27E7";
    /** 소리 낼 글에서 조각 표시를 지우는 정규식(SQL {@code regexp_replace} 도 같은 모양을 쓴다). */
    public static final String MARK_PATTERN = "\u27E6[a-z]{2}\u27E7";

    /**
     * 모델 답을 읽는다. 한 줄은 {@code 줄번호<TAB>말<TAB>글} 이고, 서로 다른 말이 이어지면 {@code <TAB>말<TAB>글} 을 더 잇는다.
     * 보낸 적 없는 번호, 목록 밖 말, 빈 글이 있는 줄은 버린다(그 줄은 지금처럼 읽힌다). 줄의 말은 한국어가 아닌 첫 조각의 말
     * (받아쓰기가 그 말로 듣는다)이고, 모두 한국어면 {@code ko} 다. 조각이 하나면 표시 없이 그 글이고, 원문과 같으면 따로 두지 않는다.
     */
    public static Map<Integer, Result> parse(String text, List<NumberedLine> sent) {
        Map<Integer, String> source = new LinkedHashMap<>();
        for (NumberedLine line : sent) {
            source.put(line.no(), line.text());
        }
        Map<Integer, Result> results = new LinkedHashMap<>();
        for (String raw : text.split("\n")) {
            String[] fields = raw.split("\t", -1);
            if (fields.length < 2) {
                continue;
            }
            int no;
            try {
                no = Integer.parseInt(fields[0].strip());
            } catch (NumberFormatException notANumber) {
                continue;
            }
            String original = source.get(no);
            if (original == null) {
                continue;
            }
            Result result = row(fields, original);
            if (result != null) {
                results.put(no, result);
            }
        }
        return results;
    }

    private static Result row(String[] fields, String original) {
        if (KOREAN.equals(fields[1].strip().toLowerCase(Locale.ROOT)) && (fields.length < 3 || fields[2].isBlank())) {
            return new Result(KOREAN, null);
        }
        List<String[]> parts = new ArrayList<>();
        for (int i = 1; i + 1 < fields.length; i += 2) {
            String lang = fields[i].strip().toLowerCase(Locale.ROOT);
            String part = fields[i + 1].strip();
            if (lang.isEmpty() && part.isEmpty()) {
                continue;
            }
            if (!SUPPORTED.contains(lang) || part.isEmpty()) {
                return null;
            }
            parts.add(new String[] {lang, part});
        }
        if (parts.isEmpty()) {
            return null;
        }
        String lang = parts.stream().map(part -> part[0]).filter(code -> !KOREAN.equals(code)).findFirst().orElse(KOREAN);
        if (KOREAN.equals(lang)) {
            return new Result(KOREAN, null);
        }
        String speech;
        if (parts.size() == 1) {
            speech = parts.getFirst()[1];
        } else {
            StringBuilder joined = new StringBuilder();
            for (String[] part : parts) {
                if (!joined.isEmpty()) {
                    joined.append(' ');
                }
                joined.append(MARK_OPEN).append(part[0]).append(MARK_CLOSE).append(part[1]);
            }
            speech = joined.toString();
        }
        if (speech.codePointCount(0, speech.length()) > SPEECH_MAX) {
            return null;
        }
        return new Result(lang, speech.equals(original.strip()) ? null : speech);
    }

}
