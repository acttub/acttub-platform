package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;

import com.acttub.actingapi.feature.reading.domain.SplitResponse.Kind;
import com.acttub.actingapi.feature.reading.domain.SplitResponse.Row;

/**
 * 모델의 줄 판정을 저장 요청의 모양({@link ScriptDraft})으로 조립한다 (SOMA-593 7-2 8·9번).
 *
 * <ul>
 *   <li>대사 글은 원문에서 머리만 뗀 것이다 — 글자를 모델이 쓰지 않는다.</li>
 *   <li>블록 형식(이름 한 줄 뒤 대사 줄들)은 같은 배역의 이어지는 줄에 머리가 없으면 한 대사로 합친다. 이을 때 단어 중간에서
 *       끊긴 자리는 붙인다({@link LineJoin}).</li>
 *   <li>판정이 없는 줄은 지문이다. 다만 지문(판정 없음 포함)이 배역 이름 + 탭·U+3000·공백 세 칸 이상으로 시작하고 뒤가 괄호
 *       지문뿐이 아니면 그 배역의 대사다. 제목·등장인물·무시 줄은 대본 줄에 넣지 않는다. 「- 27 -」만 있는 쪽 번호 줄은 모델이 뭐라
 *       하든 무시 줄이다.</li>
 *   <li>배역 순서는 등장인물 소개 줄에 나온 순, 거기 없는 배역은 대사 많은 순(같으면 먼저 말한 순)이다.</li>
 *   <li>제목은 요청의 제목, 없으면 모델이 제목이라 한 첫 줄, 그것도 없으면 첫 줄이다(200자까지).</li>
 * </ul>
 */
public final class SplitDraft {

    private static final int TITLE_MAX = 200;
    /** PDF·txt 의 쪽 번호 줄. 2026-10-13 105편에서 모델이 1,002줄 중 41줄을 대사·지문이라 해 대사 안에 「- 27 -」이 남았다. */
    private static final Pattern PAGE_NUMBER = Pattern.compile("[-–—]\\s*\\d{1,4}\\s*[-–—]");

    private SplitDraft() {
    }

    /** 성별·나이대 없이 — 모두 모름. */
    public static ScriptDraft assemble(String title, String rawText, String source, List<NumberedLine> lines,
            Map<Integer, Row> rows, List<String> roster) {
        return assemble(title, rawText, source, lines, rows, roster, Map.of());
    }

    /**
     * @param roster 배역 목록 호출이 준 이름들. 비어 있으면 이름을 바로잡지 않는다
     * @param traits 모델이 준 배역의 성별·나이대(SOMA-670). 이름 → 값. 배역 이름과 그대로, 띄어쓰기만 달라도, 배역 이름 바로잡기와
     *        같은 규칙으로 맞으면 잇고 아니면 모름이다
     */
    public static ScriptDraft assemble(String title, String rawText, String source, List<NumberedLine> lines,
            Map<Integer, Row> rows, List<String> roster, Map<String, CharacterTraits> traits) {
        List<Assembled> assembled = new ArrayList<>();
        List<String> castLines = new ArrayList<>();
        String modelTitle = null;
        LineJoin join = LineJoin.of(lines);
        List<String> known = known(rows, roster);
        for (NumberedLine line : lines) {
            Row row = rows.get(line.no());
            Kind kind = PAGE_NUMBER.matcher(ScriptText.visible(line.text()).strip()).matches() ? Kind.IGNORE
                    : row == null ? Kind.DIRECTION : row.kind();
            if (kind == Kind.DIRECTION) {
                Row named = speechOf(line, known);
                if (named != null) {
                    row = named;
                    kind = Kind.DIALOGUE;
                }
            }
            // 머리는 대사에서만 뗀다 — 장면 머리의 "S#1." 처럼 대사가 아닌 줄의 앞부분은 그 줄의 일부다.
            String header = kind == Kind.DIALOGUE ? headerOf(line.text(), row) : "";
            String body = body(line.text(), header);
            switch (kind) {
                case DIALOGUE -> {
                    if (body.isEmpty()) {
                        continue;
                    }
                    String speaker = roster.isEmpty() ? row.speaker() : CharacterNames.fix(row.speaker(), roster);
                    Assembled last = assembled.isEmpty() ? null : assembled.getLast();
                    // 대신 찾은 머리도 머리다 — 모델이 비웠다고 이름으로 시작하는 줄을 앞 대사에 붙이면 두 대사가 하나가 된다.
                    if (last != null && speaker.equals(last.speaker) && header.isEmpty()) {
                        last.text = last.text + join.glue(last.text, last.lastLine, body) + body;
                    } else {
                        last = new Assembled("dialogue", speaker, body);
                        assembled.add(last);
                    }
                    last.lastLine = line.text();
                }
                case DIRECTION, SCENE -> {
                    if (!body.isEmpty()) {
                        assembled.add(new Assembled(kind == Kind.SCENE ? "scene" : "direction", null, body));
                    }
                }
                case TITLE -> {
                    if (modelTitle == null && !body.isEmpty()) {
                        modelTitle = body;
                    }
                }
                case CAST -> castLines.add(body);
                case IGNORE -> { }
            }
        }
        List<String> characters = order(assembled, castLines);
        Map<String, Integer> index = new LinkedHashMap<>();
        for (int position = 0; position < characters.size(); position++) {
            index.put(characters.get(position), position);
        }
        List<ScriptDraft.Line> draftLines = new ArrayList<>();
        for (Assembled line : assembled) {
            draftLines.add(new ScriptDraft.Line(draftLines.size() + 1, line.kind,
                    line.speaker == null ? null : index.get(line.speaker), line.text));
        }
        return new ScriptDraft(title(title, modelTitle, lines, rows, roster), rawText, source, characters, draftLines, traitsOf(characters, traits));
    }

    private static List<CharacterTraits> traitsOf(List<String> characters, Map<String, CharacterTraits> traits) {
        List<String> named = new ArrayList<>(traits.keySet());
        List<CharacterTraits> result = new ArrayList<>(characters.size());
        for (String character : characters) {
            CharacterTraits found = named.isEmpty() ? null : traits.get(CharacterNames.fix(character, named));
            result.add(found == null ? CharacterTraits.UNKNOWN : found);
        }
        return result;
    }

    /**
     * 모델이 준 떼어낼 머리. 모델이 머리를 비웠는데 줄이 그 배역 이름과 구분 부호({@code :}·{@code .}·{@code )}·{@code ]}·{@code -})로
     * 시작하면 거기까지가 머리다 — 가짜 묶음 재측정에서 {@code MARA. } 를 비워 보내 대사 글에 이름이 남은 적이 있다. 이름 뒤에
     * 조사가 붙은 대사({@code 지수야, …})는 부호가 없어 그대로 둔다.
     *
     * <p>이름 뒤가 공백·탭·U+3000이어도 머리다(SOMA-663) — 모델은 150줄 조각 하나에서 가끔 머리 칸을 통째로 비우고(2026-10-13 같은
     * 대본 26번 중 1번), 그러면 {@code 혜진 이준호!!}·{@code 경민⇥⇥그 쪽지} 형식은 그 조각 전체에 이름이 남았다. 한 글자 이름은
     * {@code 나 갈래} 같은 대사를 망치지 않게 탭·U+3000·공백 두 칸 이상일 때만 뗀다. 들여 쓴 줄도 공백 한 칸이면 떼지 않는다.
     */
    private static String headerOf(String text, Row row) {
        if (row == null) {
            return "";
        }
        if (!row.header().isEmpty()) {
            return row.header();
        }
        String stripped = ScriptText.visible(text).stripLeading();
        String name = row.speaker();
        int start = stripped.startsWith("[") || stripped.startsWith("(") ? 1 : 0;
        if (name.isEmpty() || !stripped.startsWith(name, start)) {
            return "";
        }
        int gapStart = start + name.length();
        int end = gapStart;
        while (end < stripped.length() && " \t\u3000".indexOf(stripped.charAt(end)) >= 0) {
            end++;
        }
        if (end >= stripped.length()) {
            return "";
        }
        char separator = stripped.charAt(end);
        boolean closes = start == 1 && (separator == ']' || separator == ')');
        if (closes || "：:.-—".indexOf(separator) >= 0) {
            return stripped.substring(0, end + 1);
        }
        String gap = stripped.substring(gapStart, end);
        boolean wide = gap.length() >= 2 || gap.contains("\t") || gap.contains("\u3000");
        // 들여 쓴 줄은 블록의 이어지는 줄이다 — 「(들여쓰기)리나 맘 모르시죠?」의 이름은 대사의 일부다.
        boolean indented = stripped.length() < ScriptText.visible(text).length();
        if (start == 0 && !gap.isEmpty() && (wide || name.codePointCount(0, name.length()) >= 2 && !indented)) {
            return stripped.substring(0, end);
        }
        return "";
    }

    /** 이 대본의 배역 이름 — 모델이 대사에 쓴 이름과 배역 목록. 긴 이름부터 맞춰 보도록 길이 순이다. */
    private static List<String> known(Map<Integer, Row> rows, List<String> roster) {
        List<String> names = new ArrayList<>(roster);
        for (Row row : rows.values()) {
            if (row.kind() == Kind.DIALOGUE && !row.speaker().isBlank() && !names.contains(row.speaker())) {
                names.add(row.speaker());
            }
        }
        names.sort(Comparator.comparingInt(String::length).reversed());
        return names;
    }

    /**
     * 지문이라 판정된 줄이 「배역 이름 + 탭·U+3000·공백 세 칸 이상 + 대사」 모양이면 그 배역의 대사 판정, 아니면 null (SOMA-663).
     * 2026-10-13 105편에서 모델이 {@code 베니⇥그래.}, {@code 할머니⇥⇥(무너진다.) 안돼!!!} 같은 줄을 지문이라 해 대사가 빠졌다 —
     * 앞의 괄호 지문을 보고 줄 전체를 지문으로 본 경우가 많았다. 이름 뒤가 괄호 지문뿐이면({@code 유령⇥[무대 밑에서]}, 괄호가 다음
     * 줄로 이어지는 줄 포함) 지문으로 둔다. 공백 두 칸은 {@code 푸트남  부인이 침대로 간다.} 같은 지문이 있어 보지 않는다.
     */
    private static Row speechOf(NumberedLine line, List<String> known) {
        String stripped = ScriptText.visible(line.text()).strip();
        for (String name : known) {
            if (!stripped.startsWith(name)) {
                continue;
            }
            int end = name.length();
            while (end < stripped.length() && " \t\u3000".indexOf(stripped.charAt(end)) >= 0) {
                end++;
            }
            String gap = stripped.substring(name.length(), end);
            boolean wide = gap.contains("\t") || gap.contains("\u3000") || gap.length() >= 3;
            if (!wide || end == stripped.length() || onlyBracketed(stripped.substring(end))) {
                return null;
            }
            return new Row(line.no(), Kind.DIALOGUE, name, stripped.substring(0, end));
        }
        return null;
    }

    private static boolean onlyBracketed(String rest) {
        char open = rest.charAt(0);
        if (open != '(' && open != '[') {
            return false;
        }
        int close = rest.indexOf(open == '(' ? ')' : ']');
        return close < 0 || close == rest.length() - 1;
    }

    /** 머리를 뗀 본문. 운영 대본 여섯에 있던 줄 앞 U+200B 같은 보이지 않는 글자도 뗀다. */
    private static String body(String text, String header) {
        String stripped = ScriptText.visible(text).stripLeading();
        if (!header.isEmpty() && stripped.startsWith(ScriptText.visible(header).stripLeading())) {
            stripped = stripped.substring(ScriptText.visible(header).stripLeading().length());
        }
        return stripped.strip();
    }

    /** 등장인물 소개 줄에 처음 나타나는 순 → 나머지는 대사 많은 순, 같으면 먼저 말한 순. */
    private static List<String> order(List<Assembled> lines, List<String> castLines) {
        Map<String, int[]> seen = new LinkedHashMap<>();
        for (Assembled line : lines) {
            if (line.speaker != null) {
                seen.computeIfAbsent(line.speaker, name -> new int[] {seen.size(), 0})[1]++;
            }
        }
        Map<String, Integer> castPosition = new LinkedHashMap<>();
        for (int lineIndex = 0; lineIndex < castLines.size(); lineIndex++) {
            String squashed = CharacterNames.squash(castLines.get(lineIndex));
            for (String name : seen.keySet()) {
                int column = squashed.indexOf(CharacterNames.squash(name));
                if (column >= 0) {
                    castPosition.putIfAbsent(name, lineIndex * 10_000 + column);
                }
            }
        }
        List<String> names = new ArrayList<>(seen.keySet());
        names.sort(Comparator
                .comparing((String name) -> castPosition.getOrDefault(name, Integer.MAX_VALUE))
                .thenComparing(name -> -seen.get(name)[1])
                .thenComparing(name -> seen.get(name)[0]));
        return names;
    }

    /**
     * 제목은 요청의 title, 없으면 모델이 제목이라 한 줄, 없으면 첫 줄이다. 첫 줄이 화자 이름뿐(블록 형식의 "민수" 줄)이면
     * 그 줄은 제목 후보에서 빼고 다음 줄을 쓴다. 후보가 하나도 없으면 첫 줄이다.
     */
    private static String title(String requested, String modelTitle, List<NumberedLine> lines, Map<Integer, Row> rows,
            List<String> roster) {
        String title = requested != null && !requested.isBlank() ? requested.strip()
                : modelTitle != null ? modelTitle
                : firstLineTitle(lines, rows, roster);
        return title.codePointCount(0, title.length()) <= TITLE_MAX
                ? title
                : title.substring(0, title.offsetByCodePoints(0, TITLE_MAX));
    }

    private static String firstLineTitle(List<NumberedLine> lines, Map<Integer, Row> rows, List<String> roster) {
        if (lines.isEmpty()) {
            return "";
        }
        java.util.Set<String> names = new java.util.HashSet<>(roster);
        for (Row row : rows.values()) {
            if (row.kind() == Kind.DIALOGUE && row.speaker() != null && !row.speaker().isBlank()) {
                names.add(row.speaker().strip());
            }
        }
        for (NumberedLine line : lines) {
            String text = ScriptText.visible(line.text()).strip();
            Row row = rows.get(line.no());
            if (text.isEmpty() || names.contains(text) || (row != null && (row.kind() == Kind.IGNORE || row.kind() == Kind.CAST))) {
                continue;
            }
            return text;
        }
        return ScriptText.visible(lines.getFirst().text()).strip();
    }

    private static final class Assembled {
        final String kind;
        final String speaker;
        String text;
        /** 이 대사에 마지막으로 이은 원문 줄 — 다음 줄을 붙일지 띄울지 볼 때 끝 공백이 필요하다. */
        String lastLine;

        Assembled(String kind, String speaker, String text) {
            this.kind = kind;
            this.speaker = speaker;
            this.text = text;
        }
    }
}
