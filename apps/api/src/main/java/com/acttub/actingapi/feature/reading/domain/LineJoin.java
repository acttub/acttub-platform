package com.acttub.actingapi.feature.reading.domain;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 블록 대사의 줄을 이을 때 공백을 넣을지 (SOMA-663). 원문이 단어 중간에서 줄이 끊겨 있으면(「오⏎직」) 붙이고, 노래 가사·시처럼
 * 줄이 곧 구절인 자리(「오, 오, 오⏎잠을 깨면」)는 띄운다. 글자는 더하거나 바꾸지 않는다 — 바뀌는 것은 이음 자리의 공백 하나다.
 *
 * <p>앞 줄 끝 글자와 다음 줄 첫 글자가 둘 다 한글 음절일 때만 판단한다. 순서:
 * <ol>
 *   <li>원문 앞 줄이 공백으로 끝나면 띄운다(「쓸 ⏎데」) — 원문이 띄어 쓴 자리다.</li>
 *   <li>어느 쪽에 {@code ~}가 있으면 띄운다(「볼티모어⏎와~」) — 노래 감탄사 줄이다.</li>
 *   <li>같은 대본의 한 줄 안에서 붙여 쓴 횟수와 띄어 쓴 횟수를 견준다(「그래서」·「그 사람」).</li>
 *   <li>근거가 없으면 형태로: 앞 덩이 받침이 ㅆ·ㄶ·ㅀ이거나 「없」으로 끝나면, 다음 덩이가 어미 머리로 시작하거나 조사 하나면 붙인다.
 *       혼자 단어로도 흔한 「다 이 가 와 만 도 니」는 근거로만 정한다(「2년이⏎다 됐네」).</li>
 * </ol>
 * 2026-10-13 운영·외부 대본 318편에서 이 규칙이 붙인 2,334곳(같은 문맥은 하나로) 중 원래 띄어 쓰는 자리는 24곳이었다(「탁자⏎위에」처럼
 * 작가가 다른 곳에서 한 번 붙여 쓴 근거를 믿은 자리가 대부분).
 */
final class LineJoin {

    private static final Pattern GAP = Pattern.compile("\\s+");
    private static final Pattern EDGE = Pattern.compile("^[^\\p{L}\\p{N}_]+|[^\\p{L}\\p{N}_]+$");
    private static final List<String> ENDING_HEADS = List.of(
            "었", "았", "였", "겠", "습니", "읍니", "니다", "니까", "어요", "아요", "는데", "는지", "는구", "을", "를", "는");
    private static final Set<String> PARTICLES = Set.of(
            "을", "를", "은", "는", "에", "에서", "에게", "의", "과", "로", "으로", "까지", "부터", "처럼", "보다", "한테", "께서", "요",
            "죠", "랑", "이랑");
    private static final Set<String> COMMON_WORDS = Set.of("다", "이", "가", "와", "만", "도", "니");
    /** 받침 번호(가=0 기준 % 28): ㄶ 6, ㅀ 15, ㅆ 20. */
    private static final Set<Integer> JOINING_FINALS = Set.of(6, 15, 20);

    private final Map<String, Integer> joined = new HashMap<>();
    private final Map<String, Integer> spaced = new HashMap<>();

    private LineJoin() {
    }

    /** 근거는 나누기에 쓴 줄들(띄어쓰기 복원 뒤)의 한 줄 안에서만 센다. */
    static LineJoin of(List<NumberedLine> lines) {
        LineJoin join = new LineJoin();
        for (NumberedLine line : lines) {
            String text = ScriptText.visible(line.text()).strip();
            if (text.isEmpty()) {
                continue;
            }
            String previous = null;
            for (String piece : GAP.split(text)) {
                String word = trim(piece);
                if (!word.isEmpty()) {
                    join.joined.merge(word, 1, Integer::sum);
                }
                if (previous != null) {
                    join.spaced.merge(previous + " " + word, 1, Integer::sum);
                }
                previous = word;
            }
        }
        return join;
    }

    /**
     * @param before 지금까지 이은 대사 글
     * @param previousLine 원문에서 그 앞 줄(끝 공백이 남아 있다)
     * @param body 이어 붙일 줄의 본문
     * @return 둘 사이에 넣을 글 — 빈 문자열이나 공백 하나
     */
    String glue(String before, String previousLine, String body) {
        if (before.isEmpty() || body.isEmpty() || !syllable(before.charAt(before.length() - 1)) || !syllable(body.charAt(0))) {
            return " ";
        }
        String visible = ScriptText.visible(previousLine);
        if (!visible.isEmpty() && Character.isWhitespace(visible.charAt(visible.length() - 1))) {
            return " ";
        }
        String[] head = GAP.split(before);
        String a = head[head.length - 1];
        String b = GAP.split(body, 2)[0];
        if (a.contains("~") || b.contains("~")) {
            return " ";
        }
        a = trim(a);
        b = trim(b);
        if (a.isEmpty() || b.isEmpty()) {
            return " ";
        }
        int together = joined.getOrDefault(a + b, 0);
        int apart = spaced.getOrDefault(a + " " + b, 0);
        if (together > 0 || apart > 0) {
            return together > apart ? "" : " ";
        }
        return byShape(a, b) ? "" : " ";
    }

    private static boolean byShape(String a, String b) {
        char last = a.charAt(a.length() - 1);
        if (syllable(last) && JOINING_FINALS.contains((last - '가') % 28) || a.endsWith("없")) {
            return true;
        }
        if (COMMON_WORDS.contains(b)) {
            return false;
        }
        return PARTICLES.contains(b) || ENDING_HEADS.stream().anyMatch(b::startsWith);
    }

    private static boolean syllable(char c) {
        return c >= '가' && c <= '힣';
    }

    private static String trim(String piece) {
        return EDGE.matcher(piece).replaceAll("");
    }
}
