package com.acttub.actingapi.feature.reading.domain;

import java.util.Arrays;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 글자 대조 (reading.session · reading.recording) — 기기가 말한 것을 글자로 바꾼 결과를 대본 원문과만 맞춰 본다.
 * 괄호 안 지시와 낱자모 추임새를 빼고 문자·숫자만 소문자로 남긴 뒤 자모 단위 편집 거리로 잰 가까움이 통과선 이상이면 통과다. 가까움은
 * 저장하지도 응답에 싣지도 않는다(README 「판정 금지」).
 *
 * <p>대사를 끝까지 말하고 뒤에 말을 덧붙였으면(「방 더러워...」를 「방 더러워 안 쳤어」로) 말한 것의 앞부분만 대본과 견준다 —
 * 대사는 다 말했으니 맞게 읽은 것이다(SOMA-727). 앞에 덧붙인 말은 그대로 견준다.
 *
 * <p>앱 {@code lib/reading/match.ts} 에서 옮긴 규칙이고 웹 {@code quiz/match.ts} 와 같다(덧붙인 말 규칙은 서버만). 기기와 결과가 같도록 글자를
 * JavaScript 문자열처럼 다룬다 — 편집 거리는 UTF-16 단위로, 한도는 코드 포인트로 잰다.
 */
public final class LineMatch {
    public static final double PASS_THRESHOLD = 0.72;

    /**
     * 원문·말한 것 각각의 상한(코드 포인트). 넘으면 비교하지 않는다. 편집 거리는 자모 길이 m·⌈n/64⌉, 다르게 말한 어절은
     * 두 글자 수의 곱에 비례한다.
     */
    static final int INPUT_MAX = 1000;

    private static final Pattern BRACKETED = Pattern.compile("[(（\\[【][^)）\\]】]*[)）\\]】]");
    /** 문자·숫자가 아닌 것과 「ㅋㅋ·ㅎㅎ·ㅠㅠ」 같은 낱자모(한글 호환 자모) — 소리 내 읽는 글자가 아니다(SOMA-646). */
    private static final Pattern NOT_SPOKEN = Pattern.compile("[^\\p{L}\\p{N}]+|[\\u3131-\\u318E]+");
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
        return similarity(said, target) >= PASS_THRESHOLD || saidThenMore(said, target) >= PASS_THRESHOLD ? Result.PASS : Result.MISS;
    }

    /**
     * 말한 것의 앞부분 가운데 대본과 가장 가까운 것의 가까움 — 대사 뒤에 덧붙인 말은 세지 않는다(SOMA-727). 가까움은 같은 자모
     * 편집 거리로 재고, 앞부분이 대본보다 짧거나 길면 긴 쪽 길이로 나눈다. 말한 것이 대본보다 길지 않으면 {@link #similarity} 와 같다.
     */
    static double saidThenMore(String said, String target) {
        String a = toJamo(normalize(said));
        String b = toJamo(normalize(target));
        int m = b.length();
        if (a.length() <= m || m == 0) {
            return similarity(said, target);
        }
        // 열 j 는 「말한 것 앞 j 자모」 대 「대본 앞 i 자모」의 편집 거리. 마지막 행이 대본 전체와 앞 j 자모의 거리다.
        int[] col = new int[m + 1];
        for (int i = 0; i <= m; i++) {
            col[i] = i;
        }
        double best = 0;
        for (int j = 1; j <= a.length(); j++) {
            int diagonal = col[0];
            col[0] = j;
            char c = a.charAt(j - 1);
            for (int i = 1; i <= m; i++) {
                int up = col[i];
                col[i] = Math.min(Math.min(up + 1, col[i - 1] + 1), diagonal + (b.charAt(i - 1) == c ? 0 : 1));
                diagonal = up;
            }
            best = Math.max(best, 1 - (double) col[m] / Math.max(m, j));
        }
        return best;
    }

    static String normalize(String text) {
        String withoutDirections = BRACKETED.matcher(text).replaceAll("");
        return NOT_SPOKEN.matcher(withoutDirections).replaceAll("").toLowerCase(Locale.ROOT);
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
