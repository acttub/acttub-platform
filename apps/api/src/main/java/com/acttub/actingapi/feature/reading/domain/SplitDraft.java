package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import com.acttub.actingapi.feature.reading.domain.SplitResponse.Kind;
import com.acttub.actingapi.feature.reading.domain.SplitResponse.Row;

/**
 * 모델의 줄 판정을 저장 요청의 모양({@link ScriptDraft})으로 조립한다 (SOMA-593 7-2 8·9번).
 *
 * <ul>
 *   <li>대사 글은 원문에서 머리만 뗀 것이다 — 글자를 모델이 쓰지 않는다.</li>
 *   <li>블록 형식(이름 한 줄 뒤 대사 줄들)은 같은 배역의 이어지는 줄에 머리가 없으면 한 대사로 합친다.</li>
 *   <li>판정이 없는 줄은 지문이다. 제목·등장인물·무시 줄은 대본 줄에 넣지 않는다.</li>
 *   <li>배역 순서는 등장인물 소개 줄에 나온 순, 거기 없는 배역은 대사 많은 순(같으면 먼저 말한 순)이다.</li>
 *   <li>제목은 요청의 제목, 없으면 모델이 제목이라 한 첫 줄, 그것도 없으면 첫 줄이다(200자까지).</li>
 * </ul>
 */
public final class SplitDraft {

    private static final int TITLE_MAX = 200;

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
        for (NumberedLine line : lines) {
            Row row = rows.get(line.no());
            Kind kind = row == null ? Kind.DIRECTION : row.kind();
            // 머리는 대사에서만 뗀다 — 장면 머리의 "S#1." 처럼 대사가 아닌 줄의 앞부분은 그 줄의 일부다.
            String body = body(line.text(), kind == Kind.DIALOGUE ? headerOf(line.text(), row) : "");
            switch (kind) {
                case DIALOGUE -> {
                    if (body.isEmpty()) {
                        continue;
                    }
                    String speaker = roster.isEmpty() ? row.speaker() : CharacterNames.fix(row.speaker(), roster);
                    Assembled last = assembled.isEmpty() ? null : assembled.getLast();
                    if (last != null && speaker.equals(last.speaker) && row.header().isEmpty()) {
                        last.text = last.text + " " + body;
                    } else {
                        assembled.add(new Assembled("dialogue", speaker, body));
                    }
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
        int end = start + name.length();
        while (end < stripped.length() && stripped.charAt(end) == ' ') {
            end++;
        }
        if (end >= stripped.length()) {
            return "";
        }
        char separator = stripped.charAt(end);
        boolean closes = start == 1 && (separator == ']' || separator == ')');
        if (!closes && "：:.-—".indexOf(separator) < 0) {
            return "";
        }
        return stripped.substring(0, end + 1);
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

        Assembled(String kind, String speaker, String text) {
            this.kind = kind;
            this.speaker = speaker;
            this.text = text;
        }
    }
}
