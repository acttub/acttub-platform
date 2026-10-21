package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.List;

/**
 * 독백 — 배역이 하나뿐인 대본의 대사 줄을 문장·호흡 단위로 나눈다 (reading.script 「독백」, SOMA-597).
 *
 * <p>독백은 한 줄에 586~731자가 들어오기도 해 한 번에 30초 넘게 말해야 하고 가리기·암기가 통째로 됐다. 문장 끝 부호(마침·물음·느낌표·
 * 말줄임) 뒤에 공백이 오면 끊는다 — 괄호 안(「(웃으며. 천천히)」)과 끝 부호 뒤의 닫는 따옴표·낫표는 앞 문장에 붙인다. 지문·장면 줄은 그대로다.
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
            for (String part : parts) {
                lines.add(new ScriptDraft.Line(lines.size() + 1, line.kind(), line.characterIndex(), part, line.lang(),
                        parts.size() == 1 ? line.speech() : null));
            }
        }
        return new ScriptDraft(draft.title(), draft.rawText(), draft.source(), draft.characterNames(), lines, draft.characterTraits(),
                draft.characterMembers(), unnamed);
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
