package com.acttub.actingapi.feature.reading.domain;

import java.util.Arrays;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
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

    /**
     * 편집 거리(UTF-16 단위). 진행 저장 한 번에 300줄 넘게 비교하므로 표를 채우지 않고 비트 병렬(Myers·Hyyrö)로 센다 —
     * 줄마다 열 하나를 64행씩 한 번에 넘긴다.
     */
    static int levenshtein(String a, String b) {
        if (a.isEmpty()) {
            return b.length();
        }
        if (b.isEmpty()) {
            return a.length();
        }
        int rows = a.length();
        int blocks = (rows + 63) / 64;
        Map<Character, long[]> equal = new HashMap<>();
        for (int i = 0; i < rows; i++) {
            equal.computeIfAbsent(a.charAt(i), key -> new long[blocks])[i / 64] |= 1L << (i % 64);
        }
        long[] plus = new long[blocks];
        long[] minus = new long[blocks];
        Arrays.fill(plus, -1L);
        long lastRow = 1L << ((rows - 1) % 64);
        long[] none = new long[blocks];
        int score = rows;
        for (int j = 0; j < b.length(); j++) {
            long[] eq = equal.getOrDefault(b.charAt(j), none);
            int carry = 1;
            for (int block = 0; block < blocks; block++) {
                long pv = plus[block];
                long mv = minus[block];
                long e = eq[block];
                long xv = e | mv;
                if (carry < 0) {
                    e |= 1L;
                }
                long xh = (((e & pv) + pv) ^ pv) | e;
                long ph = mv | ~(xh | pv);
                long mh = pv & xh;
                long high = block == blocks - 1 ? lastRow : Long.MIN_VALUE;
                int out = (ph & high) != 0 ? 1 : (mh & high) != 0 ? -1 : 0;
                ph <<= 1;
                mh <<= 1;
                if (carry < 0) {
                    mh |= 1L;
                } else if (carry > 0) {
                    ph |= 1L;
                }
                plus[block] = mh | ~(xv | ph);
                minus[block] = ph & xv;
                carry = out;
            }
            score += carry;
        }
        return score;
    }
}
