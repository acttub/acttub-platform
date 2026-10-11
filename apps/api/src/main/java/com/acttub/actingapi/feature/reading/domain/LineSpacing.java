package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

/**
 * 글자마다 띄어진 줄의 띄어쓰기 복원 (reading.script 「띄어쓰기 복원」). 글자 인식으로 복사한 글은 「유 세 아 , 공 부」처럼
 * 온다. 어느 줄을 모델에 보낼지 고르고, 모델이 돌려준 줄에서는 띄어쓰기만 가져온다 — 글자는 모델이 바꾸지 못한다.
 *
 * <p>덩이는 공백으로 가른 조각이고, 한글 음절(U+AC00~U+D7A3)이 하나라도 든 덩이만 센다. 숫자·영문·부호 덩이는 판정에 들지
 * 않는다.
 */
public final class LineSpacing {

    private static final Pattern WHITESPACE = Pattern.compile("(?U)\\s+");
    /**
     * 글자가 다른 답을 맞춰 볼 줄의 최대 글자 수. 맞춰 보기는 글자 수의 곱만큼 메모리를 쓰는데(1,000자면 4MB) 조각 16개가
     * 동시에 돈다. 띄어진 대사 줄은 이보다 훨씬 짧고, 넘는 줄은 글자가 원문과 같은 답만 받는다.
     */
    private static final int ALIGN_MAX = 1_000;

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
     * 번호만 받고 빈 줄·깨진 줄은 조용히 넘긴다.
     *
     * <p>받는 것은 답의 공백 자리뿐이고 글자는 원문 그대로다. 모델은 지시를 어기고 맞춤법을 고친다(「거에요」→「거예요」,
     * 부호 하나 더함, 글자 하나 뺌) — 2026-10-11 운영 대본 두 편 361줄에서 gpt-6-luna 가 판마다 17~27줄을 그렇게 고쳤고,
     * 지시문을 다듬고 생각 양을 올려도 17줄 아래로 내려가지 않았다. 그래서 답 글자를 원문 글자에 맞춰 세우고(편집 거리)
     * 답의 공백을 짝지은 원문 글자 뒤로 옮긴다. 글자가 20% 넘게 다르면 다른 줄의 글로 보고 버린다.
     *
     * @return 번호 → 원문 글자에 답의 띄어쓰기를 입힌 줄
     */
    public static Map<Integer, String> parse(String answer, List<NumberedLine> sent) {
        Map<Integer, String> originals = new HashMap<>();
        for (NumberedLine line : sent) {
            originals.put(line.no(), line.text());
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
            String original = originals.get(no);
            String projected = original == null ? null : project(original, raw.substring(tab + 1).strip());
            if (projected != null) {
                restored.put(no, projected);
            }
        }
        return restored;
    }

    /** 원문 글자에 답의 공백을 옮긴 줄. 글자가 20% 넘게 다르거나 너무 길어 맞춰 볼 수 없으면 {@code null}. */
    private static String project(String original, String answer) {
        int[] o = original.codePoints().filter(codePoint -> !space(codePoint)).toArray();
        List<Integer> letters = new ArrayList<>();
        List<StringBuilder> gaps = new ArrayList<>();
        answer.codePoints().forEach(codePoint -> {
            if (!space(codePoint)) {
                letters.add(codePoint);
                gaps.add(new StringBuilder());
            } else if (!gaps.isEmpty()) {
                gaps.getLast().appendCodePoint(codePoint);
            }
        });
        int[] m = letters.stream().mapToInt(Integer::intValue).toArray();
        if (Arrays.equals(o, m)) {
            return answer;
        }
        if (o.length > ALIGN_MAX || m.length > ALIGN_MAX) {
            return null;
        }
        int[] pair = align(o, m);
        if (pair == null) {
            return null;
        }
        String[] after = new String[o.length];
        int paired = -1;
        for (int index = 0; index < m.length; index++) {
            if (pair[index] >= 0) {
                paired = pair[index];
            }
            String gap = gaps.get(index).toString();
            // 첫 글자 앞과 마지막 글자 뒤에는 공백을 두지 않고, 한 자리에 공백이 여럿 오면 첫 것만 둔다.
            if (!gap.isEmpty() && paired >= 0 && paired < o.length - 1 && after[paired] == null) {
                after[paired] = gap;
            }
        }
        StringBuilder out = new StringBuilder();
        for (int index = 0; index < o.length; index++) {
            out.appendCodePoint(o[index]);
            if (after[index] != null) {
                out.append(after[index]);
            }
        }
        return out.toString();
    }

    /** 편집 거리로 답 글자마다 짝지은 원문 글자의 자리(더한 글자는 -1). 편집이 원문 글자의 20% 를 넘으면 {@code null}. */
    private static int[] align(int[] o, int[] m) {
        int[][] cost = new int[o.length + 1][m.length + 1];
        for (int i = 0; i <= o.length; i++) {
            cost[i][0] = i;
        }
        for (int j = 0; j <= m.length; j++) {
            cost[0][j] = j;
        }
        for (int i = 1; i <= o.length; i++) {
            for (int j = 1; j <= m.length; j++) {
                cost[i][j] = Math.min(cost[i - 1][j - 1] + (o[i - 1] == m[j - 1] ? 0 : 1),
                        Math.min(cost[i - 1][j], cost[i][j - 1]) + 1);
            }
        }
        if (cost[o.length][m.length] * 5 > o.length) {
            return null;
        }
        int[] pair = new int[m.length];
        int i = o.length;
        int j = m.length;
        while (j > 0) {
            if (i > 0 && cost[i][j] == cost[i - 1][j - 1] + (o[i - 1] == m[j - 1] ? 0 : 1)) {
                pair[--j] = --i;
            } else if (cost[i][j] == cost[i][j - 1] + 1) {
                pair[--j] = -1;
            } else {
                i--;
            }
        }
        return pair;
    }

    /** 고친 줄로 바꾼다. 번호가 없는 줄은 그대로. */
    public static List<NumberedLine> apply(List<NumberedLine> lines, Map<Integer, String> restored) {
        List<NumberedLine> applied = new ArrayList<>(lines.size());
        for (NumberedLine line : lines) {
            applied.add(new NumberedLine(line.no(), restored.getOrDefault(line.no(), line.text())));
        }
        return applied;
    }

    /** {@link #WHITESPACE} 와 같은 공백 — 탭·줄바꿈과 NBSP·U+3000 같은 유니코드 공백. */
    private static boolean space(int codePoint) {
        return Character.isWhitespace(codePoint) || Character.isSpaceChar(codePoint);
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
