package com.acttub.actingapi.feature.reading.domain;

import java.lang.Character.UnicodeScript;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Pattern;

/**
 * 모델이 쓴 배역 이름을 배역 목록의 표기로 바로잡는다 (SOMA-593 7-4). 위에서부터 처음 맞는 규칙이다.
 *
 * <ol>
 *   <li>목록에 그대로 있으면 둔다.</li>
 *   <li>띄어쓰기만 다르면 목록 표기로.</li>
 *   <li>한 이름 안에서 글자 종류가 섞였거나(한글+영문·한자·키릴·아랍·가나) 한글·영문·숫자 밖 글자가 있으면 그 글자를 빼고
 *       편집 거리 2 이하의 목록 이름으로. 실제로 나온 예: {@code 맥베س}·{@code 맥베斯}·{@code 뱅коу}·{@code ロス}·{@code 부in}.</li>
 *   <li>편집 거리 1이면 목록 이름으로 — 세 글자 이상인 이름만. 두 글자 한국어 이름은 한 글자가 다르면 대개 다른 사람이다
 *       (운영 68편 재측정에서 「기자」가 「여자」로 합쳐졌다). 원문에 화자 머리로 쓰인 이름도 그대로 둔다 — 2026-10-20 실험 R1에서
 *       「할아버지」가 「아버지」로, 「원삼처」가 「원삼」으로, 「검사1」이 「형사1」로 합쳐졌다.</li>
 *   <li>그래도 안 맞으면 새 배역(목록을 만든 앞 400줄 뒤에 처음 나오는 인물).</li>
 * </ol>
 */
public final class CharacterNames {

    /** 내레이션 표시(NA·N·N.A.·내레이션) — 본래 배역과 나눈다(2026-10-20 사용자 정책). */
    private static final Pattern NARRATION = Pattern.compile("(?i)n\\.?(?:a\\.?)?|내레이션|나레이션");
    /** 이름 끝의 내레이션 꼬리. 괄호 없는 NA는 영문 글자 뒤가 아닐 때만 — 「Anna」는 이름이다. */
    private static final Pattern NARRATION_TAIL = Pattern.compile(
            "(?i)(?:\\(\\s*(?:n\\.?(?:a\\.?)?|내레이션|나레이션)\\s*\\)|(?<![a-z])n\\.?a\\.?|내레이션|나레이션)$");
    private static final Pattern BRACKETED = Pattern.compile("\\(([^()]*)\\)");
    /** 화면 밖 목소리 꼬리. 영문 꼬리는 한글 바로 뒤에서만(「여주VO」), 「소리」·「목소리」는 띄어 쓴 것만 — 「김소리」는 이름이다. */
    private static final Pattern VOICE_TAIL = Pattern.compile("(?<=\\p{IsHangul})\\s*(?:V\\.O\\.?|VO|O\\.S\\.?|OS)$|\\s+목?소리$");
    private static final Pattern GENDER_HEAD = Pattern.compile("^[여남]\\s+");
    private static final Pattern QUOTES = Pattern.compile("[\"“”「」『』\\[\\]\\s]");
    /** 홑따옴표는 빼지 않고 하나로 맞춘다 — 「여기자’」는 「여기자」와 다른 사람(프라임)이다(실험 R1 080). */
    private static final Pattern PRIME = Pattern.compile("[‘’′`]");

    private CharacterNames() {
    }

    public static String fix(String name, List<String> roster) {
        return fix(name, roster, Set.of());
    }

    /** @param headers 원문에 화자 머리로 쓰인 이름들({@link #squash} 모양). 이 이름은 편집 거리 1로 바꾸지 않는다 */
    public static String fix(String name, List<String> roster, Set<String> headers) {
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
        // 외국 글자 규칙은 머리여도 탄다 — 원문 머리에 섞인 외국 글자는 다른 사람이 아니라 추출이 깨진 글자다.
        if (!foreign && (name.codePointCount(0, name.length()) < 3 || headers.contains(squashed))) {
            return name;
        }
        String best = null;
        int bestDistance = Integer.MAX_VALUE;
        boolean narration = narration(name);
        for (String known : roster) {
            // 「제혁NA」는 외국 글자 규칙으로 「제혁」과 거리 2다 — 내레이션은 본래 배역과 나눈다(실험 R1 002·065·146·203)
            if (known.codePointCount(0, known.length()) < 2 || narration(known) != narration) {
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

    /**
     * 한 대본에서 같은 사람으로 묶을 화자의 모양 (SOMA-663). 띄어쓰기·겹따옴표·대괄호와 홑따옴표 모양 차이, 괄호 속 설명
     * (「철수(30대)」·「장석구 (소리)」), 화면 밖 목소리 꼬리(V.O·O.S·띄어 쓴 「목소리」·「소리」), 앞의 「여 」·「남 」을 뺀다.
     * 괄호 속이 NA·내레이션이면 남긴다.
     * 머리를 떼면 한 글자 이하가 되는 이름(「여 자」)은 머리를 남긴다 — 다른 단어가 된다.
     */
    public static String sameSpeakerKey(String name) {
        String core = BRACKETED.matcher(name.strip())
                .replaceAll(found -> NARRATION.matcher(found.group(1).strip()).matches() ? "$0" : "");
        core = VOICE_TAIL.matcher(core.strip()).replaceAll("");
        String headless = bare(GENDER_HEAD.matcher(core).replaceFirst(""));
        core = headless.codePointCount(0, headless.length()) >= 2 ? headless : bare(core);
        return core.isEmpty() ? squash(name) : core;
    }

    private static boolean narration(String name) {
        return NARRATION_TAIL.matcher(name.strip()).find();
    }

    private static String bare(String name) {
        return PRIME.matcher(QUOTES.matcher(name).replaceAll("")).replaceAll("'");
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
