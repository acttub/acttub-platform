package com.acttub.actingapi.feature.reading.domain;

import java.lang.Character.UnicodeScript;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * 모델이 쓴 배역 이름을 배역 목록의 표기로 바로잡는다 (SOMA-593 7-4). 위에서부터 처음 맞는 규칙이다.
 *
 * <ol>
 *   <li>목록에 그대로 있으면 둔다.</li>
 *   <li>띄어쓰기만 다르면 목록 표기로.</li>
 *   <li>한 이름 안에서 글자 종류가 섞였거나(한글+영문·한자·키릴·아랍·가나) 한글·영문·숫자 밖 글자가 있으면 그 글자를 빼고
 *       편집 거리 2 이하의 목록 이름으로. 실제로 나온 예: {@code 맥베س}·{@code 맥베斯}·{@code 뱅коу}·{@code ロス}·{@code 부in}.</li>
 *   <li>편집 거리 1이면 목록 이름으로 — 세 글자 이상인 이름만. 두 글자 한국어 이름은 한 글자가 다르면 대개 다른 사람이다
 *       (운영 68편 재측정에서 「기자」가 「여자」로 합쳐졌다).</li>
 *   <li>그래도 안 맞으면 새 배역(목록을 만든 앞 400줄 뒤에 처음 나오는 인물).</li>
 * </ol>
 */
public final class CharacterNames {

    private CharacterNames() {
    }

    public static String fix(String name, List<String> roster) {
        if (roster.contains(name)) {
            return name;
        }
        String squashed = squash(name);
        for (String known : roster) {
            if (squash(known).equals(squashed)) {
                return known;
            }
        }
        boolean foreign = hasForeignLetters(name) || mixesScripts(name);
        String cleaned = foreign ? withoutForeignLetters(name) : name;
        if (!foreign && name.codePointCount(0, name.length()) < 3) {
            return name;
        }
        String best = null;
        int bestDistance = Integer.MAX_VALUE;
        for (String known : roster) {
            if (known.codePointCount(0, known.length()) < 2) {
                continue;
            }
            int distance = editDistance(cleaned, known);
            if (distance < bestDistance) {
                best = known;
                bestDistance = distance;
            }
        }
        return best != null && bestDistance <= (foreign ? 2 : 1) ? best : name;
    }

    /** 띄어쓰기를 무시한 모양 — 등장인물 줄에서 이름을 찾을 때도 쓴다. */
    public static String squash(String text) {
        return text.replaceAll("\\s+", "");
    }

    private static boolean hasForeignLetters(String name) {
        return name.codePoints().anyMatch(CharacterNames::isForeign);
    }

    private static String withoutForeignLetters(String name) {
        StringBuilder kept = new StringBuilder();
        name.codePoints().filter(point -> !isForeign(point)).forEach(kept::appendCodePoint);
        return kept.toString();
    }

    /** 한글·영문·숫자·공백·흔한 부호 밖의 글자. */
    private static boolean isForeign(int point) {
        if (Character.isDigit(point) || Character.isWhitespace(point) || "().,'·-&/_".indexOf(point) >= 0) {
            return false;
        }
        UnicodeScript script = UnicodeScript.of(point);
        return script != UnicodeScript.HANGUL && script != UnicodeScript.LATIN;
    }

    /** 한 이름에 글자 종류가 둘 이상 — {@code 부in} 처럼 한글과 영문이 섞인 것도 잡는다. */
    private static boolean mixesScripts(String name) {
        Set<UnicodeScript> scripts = new HashSet<>();
        name.codePoints().filter(Character::isLetter).forEach(point -> scripts.add(UnicodeScript.of(point)));
        return scripts.size() > 1;
    }

    static int editDistance(String left, String right) {
        int[] a = left.codePoints().toArray();
        int[] b = right.codePoints().toArray();
        int[][] distance = new int[a.length + 1][b.length + 1];
        for (int i = 0; i <= a.length; i++) {
            distance[i][0] = i;
        }
        for (int j = 0; j <= b.length; j++) {
            distance[0][j] = j;
        }
        for (int i = 1; i <= a.length; i++) {
            for (int j = 1; j <= b.length; j++) {
                int substitution = distance[i - 1][j - 1] + (a[i - 1] == b[j - 1] ? 0 : 1);
                distance[i][j] = Math.min(Math.min(distance[i - 1][j] + 1, distance[i][j - 1] + 1), substitution);
            }
        }
        return distance[a.length][b.length];
    }
}
