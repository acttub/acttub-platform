package com.acttub.actingapi.feature.reading.domain;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 받아쓰기의 아라비아 숫자를 한글 읽기로 바꾼다(SOMA-606). 앱 받아쓰기는 "스물아홉"을 "29"로 적어 대본과 달라 보이게 한다.
 * 같은 숫자를 한자어("이십구")와 고유어("스물아홉") 두 가지로 읽어 보고, 대본과 맞춰 보는 쪽이 고른다.
 */
final class KoreanNumbers {
    private static final Pattern DIGITS = Pattern.compile("\\d{1,8}");
    private static final String[] SINO = {"", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"};
    private static final String[] UNITS = {"", "십", "백", "천"};
    private static final String[] NATIVE_ONES = {"", "하나", "둘", "셋", "넷", "다섯", "여섯", "일곱", "여덟", "아홉"};
    private static final String[] NATIVE_TENS = {"", "열", "스물", "서른", "마흔", "쉰", "예순", "일흔", "여든", "아흔"};

    private KoreanNumbers() {
    }

    /** 원문, 한자어로 읽은 것, (99 이하만) 고유어로 읽은 것. 숫자가 없으면 원문 하나. */
    static List<String> readings(String text) {
        LinkedHashSet<String> out = new LinkedHashSet<>();
        out.add(text);
        if (text != null && DIGITS.matcher(text).find()) {
            out.add(replace(text, false));
            out.add(replace(text, true));
        }
        return List.copyOf(out);
    }

    private static String replace(String text, boolean nativeReading) {
        Matcher m = DIGITS.matcher(text);
        StringBuilder sb = new StringBuilder();
        while (m.find()) {
            long n = Long.parseLong(m.group());
            m.appendReplacement(sb, nativeReading && n > 0 && n < 100 ? nativeOf((int) n) : sino(n));
        }
        m.appendTail(sb);
        return sb.toString();
    }

    static String nativeOf(int n) {
        return NATIVE_TENS[n / 10] + NATIVE_ONES[n % 10];
    }

    static String sino(long n) {
        if (n == 0) {
            return "영";
        }
        StringBuilder out = new StringBuilder();
        long man = n / 10_000;
        if (man > 0) {
            out.append(man == 1 ? "" : below10k((int) man)).append("만");
        }
        out.append(below10k((int) (n % 10_000)));
        return out.toString();
    }

    private static String below10k(int n) {
        StringBuilder out = new StringBuilder();
        for (int place = 3; place >= 0; place -= 1) {
            int d = (n / (int) Math.pow(10, place)) % 10;
            if (d == 0) {
                continue;
            }
            out.append(d == 1 && place > 0 ? "" : SINO[d]).append(UNITS[place]);
        }
        return out.toString();
    }
}
