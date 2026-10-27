package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.List;

/**
 * 독백 — 배역이 하나뿐인 대본의 대사 줄을 문장·호흡 단위로 나눈다 (reading.script 「독백」, SOMA-597).
 *
 * <p>독백은 한 줄에 586~731자가 들어오기도 해 한 번에 30초 넘게 말해야 하고 가리기·암기가 통째로 됐다. 문장 끝 부호(마침·물음·느낌표·
 * 말줄임) 뒤에 공백이 오면 끊는다 — 괄호 안(「(웃으며. 천천히)」)과 끝 부호 뒤의 닫는 따옴표·낫표는 앞 문장에 붙인다. 지문·장면 줄은 그대로다.
 * 끝 부호가 하나도 없어 한 문장으로 남는 대사(노래 가사·시처럼 줄 바꿈만 있는 글)는 원문의 줄 바꿈 자리에서 끊는다(SOMA-727) —
 * 원문이 띄어 쓴 자리만이고, 단어 중간에서 줄이 끊겨 붙여 이은 자리는 끊지 않는다.
 * 배역이 둘 이상인 대본(대화)은 한 배역의 연속 대사를 나누지 않는다(SOMA-663) — 여기 들어오지 않는다.
 */
public final class Monologue {
    /** 이름 없는 대사로 다시 나눈 판에서 혼자 말하는 배역에 붙이는 임시 이름 — 나누기 지시문의 「화자」와 같다. */
    public static final String PLACEHOLDER = "화자";

    private static final String ENDS = ".?!…。？！";
    private static final String CLOSERS = "\"'”’」』》〉";
    private static final String OPEN = "(（[【";
    private static final String CLOSE = ")）]】";

    private Monologue() {
    }

    /** 배역이 하나뿐인 대본인가 — 묶음 배역은 배역이 둘 이상이어야 생기므로 따로 보지 않는다. */
    public static boolean of(ScriptDraft draft) {
        return draft.characterNames().size() == 1;
    }

    /**
     * 독백이면 대사 줄을 문장마다 한 줄로 나누고 줄 번호를 다시 매긴다. 독백이 아니면 그대로다. 배역이 원문에 없는 임시 이름(「화자」)이면
     * 배우가 이름을 정할 때까지 표시해 둔다 — 첫 판도 이름 없는 독백을 「화자」로 답하곤 해서 어느 판이 나눴는지는 보지 않는다.
     */
    public static ScriptDraft split(ScriptDraft draft) {
        if (!of(draft)) {
            return draft;
        }
        boolean unnamed = draft.characterNames().getFirst().equals(PLACEHOLDER) && !draft.rawText().contains(PLACEHOLDER);
        List<ScriptDraft.Line> lines = new ArrayList<>();
        for (ScriptDraft.Line line : draft.lines()) {
            List<String> parts = "dialogue".equals(line.kind()) ? sentences(line.text()) : List.of(line.text());
            if (parts.size() == 1 && "dialogue".equals(line.kind())) {
                parts = rawLines(line.text(), draft.rawText());
            }
            for (String part : parts) {
                lines.add(new ScriptDraft.Line(lines.size() + 1, line.kind(), line.characterIndex(), part, line.lang(),
                        parts.size() == 1 ? line.speech() : null));
            }
        }
        return new ScriptDraft(draft.title(), draft.rawText(), draft.source(), draft.characterNames(), lines, draft.characterTraits(),
                draft.characterMembers(), unnamed);
    }

    /**
     * 대사 글을 원문의 줄 바꿈 자리에서 나눈다(SOMA-727). 대사는 원문 줄들을 이어 붙인 것이라, 공백을 뺀 글자로 원문 줄을 차례로 대사에
     * 맞춰 줄 경계를 찾는다. 첫 줄은 앞에 배역 이름이 붙어 있을 수 있어 줄 끝부분만 맞으면 된다. 맞지 않는 줄이 끼면(나누기가 글을 고쳤으면)
     * 나누지 않는다. 끊는 자리는 대사 글에서 공백이 있는 곳만이다.
     */
    static List<String> rawLines(String text, String rawText) {
        if (rawText == null || rawText.isBlank()) {
            return List.of(text);
        }
        StringBuilder compact = new StringBuilder();
        List<Integer> at = new ArrayList<>(); // compact 의 k 번째 글자가 text 의 몇 번째 글자인가
        for (int i = 0; i < text.length(); i++) {
            if (!Character.isWhitespace(text.charAt(i))) {
                compact.append(text.charAt(i));
                at.add(i);
            }
        }
        String target = compact.toString();
        if (target.isEmpty()) {
            return List.of(text);
        }
        List<String> rows = new ArrayList<>();
        for (String raw : rawText.split("\\R")) {
            String row = ScriptText.visible(raw).replaceAll("\\s+", "");
            if (!row.isEmpty()) {
                rows.add(row);
            }
        }
        List<Integer> cuts = null;
        for (int first = 0; first < rows.size() && cuts == null; first++) {
            cuts = boundaries(rows, first, target);
        }
        if (cuts == null || cuts.isEmpty()) {
            return List.of(text);
        }
        List<String> out = new ArrayList<>();
        int start = 0;
        for (int cut : cuts) {
            int end = at.get(cut);
            if (!Character.isWhitespace(text.charAt(end - 1))) {
                continue; // 단어 중간에서 끊긴 줄을 붙여 이은 자리
            }
            String piece = text.substring(start, end).strip();
            if (!piece.isEmpty()) {
                out.add(piece);
                start = end;
            }
        }
        String rest = text.substring(start).strip();
        if (!rest.isEmpty()) {
            out.add(rest);
        }
        return out.size() < 2 ? List.of(text) : out;
    }

    /** first 번째 원문 줄에서 대사가 시작한다고 보고 줄 경계(공백 뺀 글자 수)를 찾는다. 원문 줄들로 대사가 딱 맞게 채워지지 않으면 null. */
    private static List<Integer> boundaries(List<String> rows, int first, String target) {
        String head = rows.get(first);
        int done = Math.min(head.length(), target.length());
        while (done > 0 && !head.endsWith(target.substring(0, done))) {
            done--;
        }
        // 첫 줄은 앞에 배역 이름이 붙어 있을 수 있다 — 다만 줄 끝 한 글자만 우연히 같은 것은 시작으로 치지 않는다.
        if (done == 0 || (done < head.length() && done < 2)) {
            return null;
        }
        List<Integer> cuts = new ArrayList<>();
        for (int i = first + 1; i < rows.size() && done < target.length(); i++) {
            String row = rows.get(i);
            if (!target.startsWith(row, done)) {
                return null;
            }
            cuts.add(done);
            done += row.length();
        }
        return done == target.length() ? cuts : null;
    }

    /** 글을 문장으로 나눈다. 끊을 자리가 없으면 글 그대로(공백도 그대로) 하나다. */
    static List<String> sentences(String text) {
        List<String> out = new ArrayList<>();
        int depth = 0;
        int start = 0;
        int i = 0;
        while (i < text.length()) {
            char c = text.charAt(i);
            if (OPEN.indexOf(c) >= 0) {
                depth++;
            } else if (CLOSE.indexOf(c) >= 0) {
                depth = Math.max(0, depth - 1);
            }
            i++;
            if (depth > 0 || ENDS.indexOf(c) < 0) {
                continue;
            }
            while (i < text.length() && (ENDS.indexOf(text.charAt(i)) >= 0 || CLOSERS.indexOf(text.charAt(i)) >= 0)) {
                i++;
            }
            if (i < text.length() && Character.isWhitespace(text.charAt(i))) {
                String sentence = text.substring(start, i).strip();
                if (!sentence.isEmpty() && !text.substring(i).isBlank()) {
                    out.add(sentence);
                    start = i;
                }
            }
        }
        String rest = text.substring(start).strip();
        if (!rest.isEmpty()) {
            out.add(rest);
        }
        return out.size() < 2 ? List.of(text) : out;
    }
}
