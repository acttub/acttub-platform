package com.acttub.actingapi.feature.reading.domain;

import java.lang.Character.UnicodeScript;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 모델이 쓴 배역 이름을 배역 목록의 표기로 바로잡는다 (SOMA-593 7-4). 위에서부터 처음 맞는 규칙이다.
 *
 * <ol>
 *   <li>목록에 그대로 있으면 둔다.</li>
 *   <li>띄어쓰기만 다르면 목록 표기로.</li>
 *   <li>함께 말하기 이름은 사람마다 목록 표기로({@code JIMMY/SAND} → {@code JIMMY/SANDRINE}, {@link #group}).</li>
 *   <li>이름 전체를 감싼 대괄호·겹따옴표는 떼고 안쪽 이름으로 맞춘다. 안 맞으면 감싼 그대로 둔다.</li>
 *   <li>한 이름 안에서 글자 종류가 섞였거나(한글+영문·한자·키릴·아랍·가나) 한글·영문·숫자 밖 글자가 있으면 그 글자를 빼고
 *       편집 거리 2 이하의 목록 이름으로. 실제로 나온 예: {@code 맥베س}·{@code 맥베斯}·{@code 뱅коу}·{@code ロス}·{@code 부in}.</li>
 *   <li>편집 거리 1이면 목록 이름으로 — 세 글자 이상인 이름만. 두 글자 한국어 이름은 한 글자가 다르면 대개 다른 사람이다
 *       (운영 68편 재측정에서 「기자」가 「여자」로 합쳐졌다). 원문에 화자 머리로 쓰인 이름도 그대로 둔다 — 2026-10-20 실험 R1에서
 *       「할아버지」가 「아버지」로, 「원삼처」가 「원삼」으로, 「검사1」이 「형사1」로 합쳐졌다. 숫자가 다르면(「형사1」·「형사2」) 거리와 상관없이
 *       다른 사람이다(SOMA-709).</li>
 *   <li>그래도 안 맞으면 새 배역(목록을 만든 앞 400줄 뒤에 처음 나오는 인물).</li>
 * </ol>
 */
public final class CharacterNames {

    /** 내레이션 표시(NA·N·N.A.·내레이션) — 본래 배역과 나눈다(2026-10-20 사용자 정책). */
    private static final Pattern NARRATION = Pattern.compile("(?iu)n\\.?(?:a\\.?)?|내레이션|나레이션");
    /** 이름 끝의 내레이션 꼬리. 괄호 없는 NA는 영문 글자 뒤가 아닐 때만 — 「Anna」는 이름이다. */
    private static final Pattern NARRATION_TAIL = Pattern.compile(
            "(?iu)(?:\\(\\s*(?:n\\.?(?:a\\.?)?|내레이션|나레이션)\\s*\\)|(?<![a-z])n\\.?a\\.?|내레이션|나레이션)$");
    private static final Pattern BRACKETED = Pattern.compile("\\(([^()]*)\\)");
    /** 괄호 속 역할 표시 — 「민(영혼)」·「재하(어린)」은 본래 배역과 다른 연습 배역이다(2026-10-20 사용자 정책). */
    private static final Pattern ROLE = Pattern.compile("영혼|어린|젊은");
    /** 화면 밖 목소리 꼬리. 「윤성구/음성」처럼 빗금 뒤 채널도 꼬리다(재생 054). 영문 꼬리는 한글 바로 뒤에서만(「여주VO」), 「소리」·「목소리」는 띄어 쓴 것만 — 「김소리」는 이름이다. */
    private static final Pattern VOICE_TAIL = Pattern.compile("(?<=\\p{IsHangul})\\s*(?:V\\.O\\.?|VO|O\\.S\\.?|OS)$|\\s+목?소리$|\\s*/\\s*(?:음성|목?소리)$");
    /** 머리의 구분 부호가 이름에 남은 꼴 — 「가현:」·「박사장 (V.O):」는 「가현」·「박사장」이다(2026-10-20 개발 묶음 063·073). */
    private static final Pattern TRAILING_COLON = Pattern.compile("[\\s:：]+$");
    /** 함께 말하기 이름의 사람 사이 구분 부호. */
    private static final Pattern GROUP_SEPARATOR = Pattern.compile("\\s*[/,·•∙・&]\\s*");
    private static final Pattern GENDER_HEAD = Pattern.compile("^[여남]\\s+");
    private static final Pattern QUOTES = Pattern.compile("[\"“”「」『』\\[\\]\\s]");
    /** 이름 전체를 감싼 대괄호·겹따옴표 한 쌍. */
    private static final Pattern WRAPPED = Pattern.compile("[\\[\"“「『]([^\\[\\]\"“”「」『』]+)[\\]\"”」』]");
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
        String group = headers.contains(squashed) ? null : group(name, roster);
        if (group != null) {
            return group;
        }
        // 바깥을 감싼 대괄호·겹따옴표는 이름표 표시다 — 외국 글자로 보면 「[무전]」이 거리 2의 「가지」가 됐다(SOMA-663 M7, 재생 120)
        Matcher wrapped = WRAPPED.matcher(name.strip());
        if (wrapped.matches()) {
            String inner = wrapped.group(1).strip();
            String fixed = fix(inner, roster, headers);
            return fixed.equals(inner) && !roster.contains(inner) ? name : fixed;
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
            if (known.codePointCount(0, known.length()) < 2 || narration(known) != narration || !sameNumbers(cleaned, known)) {
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
     * 함께 말하기 이름(「JIMMY/SAND」)을 사람마다 목록 표기로 맞춘 것 (SOMA-663 M7, 재생 178). 조각마다 목록에 같은 이름(띄어쓰기 무시)이
     * 있거나, 두 글자 이상의 앞부분으로 시작하는 목록 이름이 하나뿐이어야 한다 — 「학생」↔「학생1」·「학생2」처럼 여럿이면 두고, 내레이션
     * 표시가 다르면 다른 사람이다. 빗금 뒤 음성 채널(「윤성구/음성」)은 함께 말하기가 아니다. 바뀐 조각이 없거나 하나라도 못 맞추면 null.
     */
    private static String group(String name, List<String> roster) {
        if (VOICE_TAIL.matcher(name).find()) {
            return null;
        }
        List<String> singles = roster.stream().filter(known -> !GROUP_SEPARATOR.matcher(known).find()).toList();
        Matcher separator = GROUP_SEPARATOR.matcher(name);
        StringBuilder fixed = new StringBuilder();
        int start = 0;
        int parts = 0;
        boolean changed = false;
        while (true) {
            boolean more = separator.find();
            String part = name.substring(start, more ? separator.start() : name.length()).strip();
            String member = member(part, singles);
            if (member == null) {
                return null;
            }
            changed |= !member.equals(part);
            fixed.append(member);
            parts++;
            if (!more) {
                break;
            }
            fixed.append(separator.group());
            start = separator.end();
        }
        return parts >= 2 && changed ? fixed.toString() : null;
    }

    private static String member(String part, List<String> singles) {
        String squashed = squash(part);
        for (String known : singles) {
            if (squash(known).equals(squashed)) {
                return known;
            }
        }
        List<String> longer = singles.stream()
                .filter(known -> squash(known).startsWith(squashed) && narration(known) == narration(part)).toList();
        return squashed.codePointCount(0, squashed.length()) >= 2 && longer.size() == 1 ? longer.getFirst() : null;
    }

    /**
     * 한 대본에서 같은 사람으로 묶을 화자의 모양 (SOMA-663). 띄어쓰기·겹따옴표·대괄호와 홑따옴표 모양 차이, 괄호 속 설명
     * (「철수(30대)」·「장석구 (소리)」), 화면 밖 목소리 꼬리(V.O·O.S·띄어 쓴 「목소리」·「소리」), 앞의 「여 」·「남 」, 끝의 쌍점을 뺀다.
     * 괄호 속이 NA·내레이션이거나 역할 표시(영혼·어린·젊은)면 남긴다.
     * 머리를 떼면 한 글자 이하가 되는 이름(「여 자」)은 머리를 남긴다 — 다른 단어가 된다.
     */
    public static String sameSpeakerKey(String name) {
        String core = BRACKETED.matcher(TRAILING_COLON.matcher(name.strip()).replaceAll(""))
                .replaceAll(found -> NARRATION.matcher(found.group(1).strip()).matches() || ROLE.matcher(found.group(1)).find() ? "$0" : "");
        core = VOICE_TAIL.matcher(core.strip()).replaceAll("");
        String headless = bare(GENDER_HEAD.matcher(core).replaceFirst(""));
        core = headless.codePointCount(0, headless.length()) >= 2 ? headless : bare(core);
        return core.isEmpty() ? squash(name) : core;
    }

    /** 이름 속 숫자가 같은가 — 숫자만 다른 이름(「형사1」·「형사2」)은 다른 사람이다(SOMA-709). */
    static boolean sameNumbers(String a, String b) {
        return a.replaceAll("\\D", "").equals(b.replaceAll("\\D", ""));
    }

    static boolean narration(String name) {
        return NARRATION_TAIL.matcher(name.strip()).find();
    }

    /** 내레이션이거나 괄호 속 역할 표시가 있는 이름 — 표시 없는 같은 이름과 다른 연습 배역이다. */
    static boolean marked(String name) {
        return narration(name) || BRACKETED.matcher(name).results().anyMatch(found -> ROLE.matcher(found.group(1)).find());
    }

    private static String bare(String name) {
        return PRIME.matcher(QUOTES.matcher(name).replaceAll("")).replaceAll("'");
    }

    /** 띄어쓰기를 무시한 모양 — 등장인물 줄에서 이름을 찾을 때도 쓴다. */
    public static String squash(String text) {
        return text.replaceAll("\\s+", "");
    }

    static boolean hasForeignLetters(String name) {
        return name.codePoints().anyMatch(CharacterNames::isForeign);
    }

    private static String withoutForeignLetters(String name) {
        StringBuilder kept = new StringBuilder();
        name.codePoints().filter(point -> !isForeign(point)).forEach(kept::appendCodePoint);
        return kept.toString();
    }

    /** 한글·영문·숫자·공백·흔한 부호 밖의 글자. */
    private static boolean isForeign(int point) {
        if (Character.isDigit(point) || Character.isWhitespace(point) || "().,'·•∙・-&/_".indexOf(point) >= 0) {
            return false;
        }
        UnicodeScript script = UnicodeScript.of(point);
        return script != UnicodeScript.HANGUL && script != UnicodeScript.LATIN;
    }

    /** 한 이름에 글자 종류가 둘 이상 — {@code 부in} 처럼 한글과 영문이 섞인 것도 잡는다. */
    static boolean mixesScripts(String name) {
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
