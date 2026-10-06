package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 원문과 다르게 말한 어절 (reading.session) — 띄어쓰기·문장부호·괄호 안 지시를 빼고 글자 단위로 맞춰 본 뒤(최장 공통
 * 부분열), 맞지 않는 글자가 있는 원문 어절만 표시한다. 더한 말은 원문에 자리가 없어 표시하지 않는다.
 *
 * <p>앱 {@code lib/reading/word-diff.ts} 에서 옮긴 규칙이다. 어절은 JavaScript {@code \s} 와 같은 공백으로 나눈다 — Java 의
 * {@code \s} 는 ASCII 공백만 본다.
 */
public final class WordDiff {
    private static final Pattern JS_WHITESPACE =
            Pattern.compile("[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]+");

    private WordDiff() {
    }

    /** 원문 어절 하나. {@code differs} 면 그 어절에 말한 것과 맞지 않는 글자가 있다. */
    public record Word(String text, boolean differs) {
    }

    /** 원문 어절 전부를 순서대로, 표시 없이. */
    public static List<Word> plain(String target) {
        return words(target).stream().map(text -> new Word(text, false)).toList();
    }

    public static List<Word> diff(String target, String said) {
        List<String> words = words(target);
        Map<String, Integer> letters = new HashMap<>();
        List<int[]> units = new ArrayList<>();
        int depth = 0;
        for (int word = 0; word < words.size(); word++) {
            for (int code : words.get(word).codePoints().toArray()) {
                if (code == '(' || code == '（' || code == '[' || code == '【') {
                    depth += 1;
                } else if (code == ')' || code == '）' || code == ']' || code == '】') {
                    depth = Math.max(0, depth - 1);
                } else if (depth == 0 && comparable(code)) {
                    units.add(new int[] {word, letter(letters, code)});
                }
            }
        }
        int[] spoken = said.codePoints().filter(WordDiff::comparable).map(code -> letter(letters, code)).toArray();
        int[] unitWord = units.stream().mapToInt(unit -> unit[0]).toArray();
        int[] unitLetter = units.stream().mapToInt(unit -> unit[1]).toArray();
        int n = unitLetter.length;
        int m = spoken.length;
        if (n > LineMatch.INPUT_MAX || m > LineMatch.INPUT_MAX) {
            return plain(target);
        }

        int[] lcs = new int[(n + 1) * (m + 1)];
        for (int i = n - 1; i >= 0; i--) {
            for (int j = m - 1; j >= 0; j--) {
                lcs[i * (m + 1) + j] = unitLetter[i] == spoken[j]
                        ? lcs[(i + 1) * (m + 1) + j + 1] + 1
                        : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
            }
        }
        boolean[] differs = new boolean[words.size()];
        int i = 0;
        int j = 0;
        while (i < n) {
            if (j < m && unitLetter[i] == spoken[j]) {
                i += 1;
                j += 1;
            } else if (j < m && lcs[i * (m + 1) + j + 1] >= lcs[(i + 1) * (m + 1) + j]) {
                j += 1;
            } else {
                differs[unitWord[i]] = true;
                i += 1;
            }
        }
        List<Word> out = new ArrayList<>(words.size());
        for (int word = 0; word < words.size(); word++) {
            out.add(new Word(words.get(word), differs[word]));
        }
        return out;
    }

    private static List<String> words(String target) {
        return Arrays.stream(JS_WHITESPACE.split(target)).filter(word -> !word.isEmpty()).toList();
    }

    private static boolean comparable(int code) {
        return Character.isLetter(code) || isNumber(code);
    }

    private static boolean isNumber(int code) {
        int type = Character.getType(code);
        return type == Character.DECIMAL_DIGIT_NUMBER || type == Character.LETTER_NUMBER || type == Character.OTHER_NUMBER;
    }

    /** 소문자로 바꾼 글자에 번호를 준다 — 소문자가 두 글자 이상이 되는 글자(İ)도 JavaScript 처럼 한 단위로 견준다. */
    private static int letter(Map<String, Integer> letters, int code) {
        return letters.computeIfAbsent(new String(Character.toChars(code)).toLowerCase(Locale.ROOT), key -> letters.size());
    }
}
