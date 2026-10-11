package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 글자마다 띄어진 줄의 띄어쓰기 복원 (reading.script 「띄어쓰기 복원」). 글자 인식으로 복사한 글은 「유 세 아 , 공 부」처럼
 * 온다. 어느 줄을 모델에 보낼지 고르고, 모델이 돌려준 줄은 공백만 바뀐 것일 때만 받는다 — 글자는 모델이 바꾸지 못한다.
 *
 * <p>덩이는 공백으로 가른 조각이고, 한글 음절(U+AC00~U+D7A3)이 하나라도 든 덩이만 센다. 숫자·영문·부호 덩이는 판정에 들지
 * 않는다.
 */
public final class LineSpacing {

    private static final Pattern WHITESPACE = Pattern.compile("(?U)\\s+");

    private LineSpacing() {
    }

    /** 한글 덩이가 넷 이상이고 그 80% 이상이 한글 한 글자뿐인 줄. */
    public static boolean spaced(String text) {
        Count count = count(text);
        return count.hangul >= 4 && count.single * 5 >= count.hangul * 4;
    }

    /** 한글 덩이가 둘 이상이고 모두 한 글자인 짧은 줄(「( 암 전 )」). 혼자서는 복원을 부르지 않는다. */
    public static boolean shortSpaced(String text) {
        Count count = count(text);
        return count.hangul >= 2 && count.single == count.hangul;
    }

    /** 보낼 줄. 띄어진 줄이 하나도 없으면 비고, 있으면 띄어진 줄과 짧게 띄어진 줄을 순서대로. */
    public static List<NumberedLine> toRestore(List<NumberedLine> lines) {
        if (lines.stream().noneMatch(line -> spaced(line.text()))) {
            return List.of();
        }
        return lines.stream().filter(line -> spaced(line.text()) || shortSpaced(line.text())).toList();
    }

    /**
     * 모델의 답을 읽는다. 답은 {@code 줄번호<TAB>고친 줄} 한 줄씩이고 첫 탭에서만 가른다 — 줄 안의 탭은 글에 남는다. 보낸 줄
     * 번호이고 공백을 모두 뺀 글자가 원문과 같을 때만 받는다. 빈 줄·깨진 줄은 조용히 넘긴다.
     *
     * @return 번호 → 고친 줄(앞뒤 공백을 뺀 것)
     */
    public static Map<Integer, String> parse(String answer, List<NumberedLine> sent) {
        Map<Integer, String> letters = new HashMap<>();
        for (NumberedLine line : sent) {
            letters.put(line.no(), letters(line.text()));
        }
        Map<Integer, String> restored = new LinkedHashMap<>();
        for (String raw : answer.split("\n")) {
            int tab = raw.indexOf('\t');
            if (tab < 0) {
                continue;
            }
            int no;
            try {
                no = Integer.parseInt(raw.substring(0, tab).strip());
            } catch (NumberFormatException notANumber) {
                continue;
            }
            String text = raw.substring(tab + 1).strip();
            if (letters(text).equals(letters.get(no))) {
                restored.put(no, text);
            }
        }
        return restored;
    }

    /** 고친 줄로 바꾼다. 번호가 없는 줄은 그대로. */
    public static List<NumberedLine> apply(List<NumberedLine> lines, Map<Integer, String> restored) {
        List<NumberedLine> applied = new ArrayList<>(lines.size());
        for (NumberedLine line : lines) {
            applied.add(new NumberedLine(line.no(), restored.getOrDefault(line.no(), line.text())));
        }
        return applied;
    }

    private static String letters(String text) {
        return WHITESPACE.matcher(text).replaceAll("");
    }

    private record Count(int hangul, int single) {
    }

    private static Count count(String text) {
        int hangul = 0;
        int single = 0;
        for (String token : WHITESPACE.split(text.strip())) {
            if (token.codePoints().anyMatch(LineSpacing::syllable)) {
                hangul++;
                if (token.length() == 1) {
                    single++;
                }
            }
        }
        return new Count(hangul, single);
    }

    private static boolean syllable(int codePoint) {
        return codePoint >= 0xAC00 && codePoint <= 0xD7A3;
    }
}
