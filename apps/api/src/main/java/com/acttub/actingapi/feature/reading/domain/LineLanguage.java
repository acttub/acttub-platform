package com.acttub.actingapi.feature.reading.domain;

import java.util.LinkedHashMap;
import java.util.List;
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
     * 모델 답을 읽는다. 보낸 적 없는 번호, 목록 밖 말, 소리 낼 글이 빈 외국어 줄은 버린다(그 줄은 지금처럼 읽힌다).
     * 소리 낼 글이 원문과 같으면 따로 두지 않는다.
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
            String lang = fields[1].strip().toLowerCase(java.util.Locale.ROOT);
            if (original == null || !SUPPORTED.contains(lang)) {
                continue;
            }
            if (KOREAN.equals(lang)) {
                results.put(no, new Result(KOREAN, null));
                continue;
            }
            String speech = fields.length > 2 ? fields[2].strip() : "";
            if (speech.isEmpty() || speech.codePointCount(0, speech.length()) > SPEECH_MAX) {
                continue;
            }
            results.put(no, new Result(lang, speech.equals(original.strip()) ? null : speech));
        }
        return results;
    }
}
