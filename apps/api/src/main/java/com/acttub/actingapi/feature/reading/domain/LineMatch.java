package com.acttub.actingapi.feature.reading.domain;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * 글자 대조 (reading.session · reading.recording) — 기기가 말한 것을 글자로 바꾼 결과를 대본 원문과만 맞춰 본다.
 * 괄호 안 지시를 빼고 문자·숫자만 소문자로 남긴 뒤 자모 단위 편집 거리로 잰 가까움이 통과선 이상이면 통과다. 가까움은
 * 저장하지도 응답에 싣지도 않는다(README 「판정 금지」).
 *
 * <p>앱 {@code lib/reading/match.ts} 에서 옮긴 규칙이고 웹 {@code quiz/match.ts} 와 같다. 기기와 결과가 같도록 글자를
 * JavaScript 문자열처럼 다룬다 — 편집 거리는 UTF-16 단위로, 한도는 코드 포인트로 잰다.
 */
public final class LineMatch {
    static final double PASS_THRESHOLD = 0.72;

    /** 원문·말한 것 각각의 상한(코드 포인트). 대조는 두 길이의 곱에 비례한다. */
    static final int INPUT_MAX = 1000;

    private static final Pattern BRACKETED = Pattern.compile("[(（\\[【][^)）\\]】]*[)）\\]】]");
    private static final Pattern NOT_LETTER_OR_DIGIT = Pattern.compile("[^\\p{L}\\p{N}]+");
    private static final String CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ";
    private static final String JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ";
    private static final String[] JONG = {"", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ",
        "ㅀ", "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"};

    private LineMatch() {
    }

    public enum Result {
        PASS,
        MISS,
        /** 인식 불가·무발화. 미달로 세지 않는다. */
        NO_SPEECH,
        /** 한도 초과. 대조하지 않고 미달로 세지 않는다. */
        TOO_LONG
    }

    public static Result compare(String said, String target) {
        if (said.codePointCount(0, said.length()) > INPUT_MAX || target.codePointCount(0, target.length()) > INPUT_MAX) {
            return Result.TOO_LONG;
        }
        if (normalize(said).isEmpty()) {
            return Result.NO_SPEECH;
        }
        return similarity(said, target) >= PASS_THRESHOLD ? Result.PASS : Result.MISS;
    }

    static String normalize(String text) {
        String withoutDirections = BRACKETED.matcher(text).replaceAll("");
        return NOT_LETTER_OR_DIGIT.matcher(withoutDirections).replaceAll("").toLowerCase(Locale.ROOT);
    }

    static double similarity(String said, String target) {
        String a = toJamo(normalize(said));
        String b = toJamo(normalize(target));
        if (a.isEmpty() && b.isEmpty()) {
            return 1;
        }
        return 1 - (double) levenshtein(a, b) / Math.max(a.length(), b.length());
    }

    private static String toJamo(String text) {
        StringBuilder out = new StringBuilder(text.length() * 3);
        text.codePoints().forEach(code -> {
            if (code < 0xac00 || code > 0xd7a3) {
                out.appendCodePoint(code);
                return;
            }
            int index = code - 0xac00;
            out.append(CHO.charAt(index / 588)).append(JUNG.charAt(index % 588 / 28)).append(JONG[index % 28]);
        });
        return out.toString();
    }

    private static int levenshtein(String a, String b) {
        if (a.isEmpty()) {
            return b.length();
        }
        if (b.isEmpty()) {
            return a.length();
        }
        int[] previous = new int[b.length() + 1];
        int[] current = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) {
            previous[j] = j;
        }
        for (int i = 1; i <= a.length(); i++) {
            current[0] = i;
            char left = a.charAt(i - 1);
            for (int j = 1; j <= b.length(); j++) {
                int substitution = previous[j - 1] + (left == b.charAt(j - 1) ? 0 : 1);
                current[j] = Math.min(Math.min(previous[j] + 1, current[j - 1] + 1), substitution);
            }
            int[] swap = previous;
            previous = current;
            current = swap;
        }
        return previous[b.length()];
    }
}
