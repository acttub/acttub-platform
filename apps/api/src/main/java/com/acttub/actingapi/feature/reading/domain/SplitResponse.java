package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;

/**
 * 모델의 답을 읽는다 (SOMA-593 7-2 6번·7-14). 답은 {@code 줄번호<TAB>종류<TAB>배역<TAB>떼어낼머리} 한 줄씩이고, 첫 호출은
 * 맨 앞에 {@code 대본<TAB>예|아니오} 한 줄을 더 쓴다.
 *
 * <p>버리는 줄: 보낸 적 없는 줄 번호, 여섯 종류 밖, 떼어낼 머리가 그 줄의 시작과 다른 것(보이지 않는 글자는 빼고 견준다), 배역이 빈 대사. 버린 줄은 빠진
 * 줄과 같이 다시 묻는다. 판단 줄이 없거나 깨졌으면 대본으로 본다 — 판단 실패가 넣기를 막지 않게.
 *
 * @param rows 받아들인 줄. 번호 → 판정
 * @param script 판단 줄의 답. 없거나 깨졌으면 {@code null}
 * @param rejected 버린 줄 수
 */
public record SplitResponse(Map<Integer, Row> rows, Boolean script, int rejected) {

    private static final String JUDGMENT_PREFIX = "대본\t";

    public SplitResponse {
        rows = Map.copyOf(rows);
    }

    public boolean notScript() {
        return Boolean.FALSE.equals(script);
    }

    public static SplitResponse parse(String text, List<NumberedLine> sent) {
        Map<Integer, String> source = new LinkedHashMap<>();
        for (NumberedLine line : sent) {
            source.put(line.no(), line.text());
        }
        Map<Integer, Row> rows = new LinkedHashMap<>();
        Boolean script = null;
        boolean first = true;
        int rejected = 0;
        for (String raw : text.split("\n")) {
            String line = raw.strip();
            if (line.isEmpty()) {
                continue;
            }
            if (first) {
                first = false;
                Boolean judged = judgment(raw);
                if (judged != null) {
                    script = judged;
                    continue;
                }
            }
            Row row = row(raw, source);
            if (row == null) {
                rejected++;
                continue;
            }
            rows.put(row.no(), row);
        }
        return new SplitResponse(rows, script, rejected);
    }

    /** 배역 목록 호출의 답 — 한 줄에 이름 하나. 글머리표·번호를 떼고 판단 줄은 뺀다. */
    public static List<String> roster(String text) {
        LinkedHashSet<String> names = new LinkedHashSet<>();
        for (String raw : text.split("\n")) {
            if (judgment(raw) != null) {
                continue;
            }
            String name = raw.strip().replaceFirst("^[-*•\\d.)\\s]+", "").strip();
            if (!name.isEmpty()) {
                names.add(name);
            }
        }
        return new ArrayList<>(names);
    }

    private static Boolean judgment(String raw) {
        String line = raw.strip();
        if (!line.startsWith(JUDGMENT_PREFIX)) {
            return null;
        }
        String answer = line.substring(JUDGMENT_PREFIX.length()).strip();
        return switch (answer) {
            case "예" -> Boolean.TRUE;
            case "아니오", "아니요" -> Boolean.FALSE;
            default -> null;
        };
    }

    private static Row row(String raw, Map<Integer, String> source) {
        String[] fields = raw.split("\t", -1);
        if (fields.length < 2) {
            return null;
        }
        int no;
        try {
            no = Integer.parseInt(fields[0].strip());
        } catch (NumberFormatException notANumber) {
            return null;
        }
        String original = source.get(no);
        Kind kind = Kind.of(fields[1].strip());
        if (original == null || kind == null) {
            return null;
        }
        String speaker = fields.length > 2 ? fields[2].strip() : "";
        String header = fields.length > 3 ? fields[3] : "";
        // 줄 앞 U+200B 를 모델이 떨어뜨리고 머리를 써도 그 줄을 버리지 않는다 — 양쪽에서 보이지 않는 글자를 뺀 뒤 견준다.
        if (!header.isBlank() && !ScriptText.visible(original).stripLeading().startsWith(ScriptText.visible(header).stripLeading())) {
            return null;
        }
        if (kind == Kind.DIALOGUE && speaker.isEmpty()) {
            return null;
        }
        return new Row(no, kind, kind == Kind.DIALOGUE ? speaker : "", header.isBlank() ? "" : header.stripLeading());
    }

    /**
     * 줄 하나의 판정.
     *
     * @param header 그 줄 맨 앞에서 뗄 부분(예: {@code 윤서: }). 없으면 빈 문자열
     */
    public record Row(int no, Kind kind, String speaker, String header) {
    }

    /** 모델이 쓰는 한 글자 종류. */
    public enum Kind {
        DIALOGUE("d"),
        DIRECTION("x"),
        SCENE("s"),
        TITLE("t"),
        CAST("c"),
        IGNORE("i");

        private final String code;

        Kind(String code) {
            this.code = code;
        }

        static Kind of(String code) {
            for (Kind kind : values()) {
                if (kind.code.equals(code)) {
                    return kind;
                }
            }
            return null;
        }
    }
}
