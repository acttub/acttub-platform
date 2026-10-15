package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 모델의 답을 읽는다 (SOMA-593 7-2 6번·7-14). 답은 {@code 줄번호<TAB>종류<TAB>배역<TAB>떼어낼머리} 한 줄씩이고, 첫 호출은
 * 맨 앞에 {@code 대본<TAB>예|아니오} 한 줄을 더 쓴다.
 *
 * <p>버리는 줄: 보낸 적 없는 줄 번호, 여섯 종류 밖, 떼어낼 머리가 그 줄의 시작과 다른 것(보이지 않는 글자는 빼고 견준다), 배역이 빈 대사. 버린 줄은 빠진
 * 줄과 같이 다시 묻는다. 판단 줄이 없거나 깨졌으면 대본으로 본다 — 판단 실패가 넣기를 막지 않게.
 *
 * <p>짧은 대본(조각 하나)의 첫 호출은 답 끝에 {@code 배역} 한 줄과 그 아래 {@code 이름<TAB>성별<TAB>나이대} 줄들을 더 쓴다
 * (SOMA-670). 머리 줄 뒤의 줄은 줄 판정으로 읽히면 줄 판정이고 아니면 배역 줄이다 — 블록이 없거나 깨졌으면 성별·나이대를
 * 모를 뿐 줄 판정은 그대로다.
 *
 * @param rows 받아들인 줄. 번호 → 판정
 * @param script 판단 줄의 답. 없거나 깨졌으면 {@code null}
 * @param rejected 버린 줄 수
 * @param traits 「배역」 블록의 성별·나이대. 이름 → 값. 블록이 없으면 비어 있다
 */
public record SplitResponse(Map<Integer, Row> rows, Boolean script, int rejected, Map<String, CharacterTraits> traits) {

    private static final String JUDGMENT_PREFIX = "대본\t";
    /** 「배역」 블록의 머리 줄. 지시문({@code ScriptSplitPrompt})과 같은 글자다. */
    public static final String CAST_HEADER = "배역";

    public SplitResponse {
        rows = Map.copyOf(rows);
        traits = Map.copyOf(traits);
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
        Map<String, CharacterTraits> traits = new LinkedHashMap<>();
        Boolean script = null;
        boolean first = true;
        boolean inCast = false;
        int rejected = 0;
        for (String raw : text.split("\n")) {
            String line = raw.strip();
            if (line.isEmpty()) {
                continue;
            }
            if (line.equals(CAST_HEADER)) {
                inCast = true;
                first = false;
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
                if (inCast) {
                    castLine(raw, traits);
                } else {
                    rejected++;
                }
                continue;
            }
            rows.put(row.no(), row);
        }
        return new SplitResponse(rows, script, rejected, traits);
    }

    /** 배역 목록 호출의 답에서 이름만 — 한 줄에 {@code 이름<TAB>성별<TAB>나이대}(이름만 써도 받는다). */
    public static List<String> roster(String text) {
        return new ArrayList<>(rosterTraits(text).keySet());
    }

    /**
     * 배역 목록 호출의 답 (SOMA-670). 한 줄에 {@code 이름<TAB>성별<TAB>나이대}, 글머리표·번호를 떼고 판단 줄과 「배역」 머리
     * 줄은 뺀다. 같은 이름은 처음 줄을 쓴다.
     */
    public static Map<String, CharacterTraits> rosterTraits(String text) {
        Map<String, CharacterTraits> traits = new LinkedHashMap<>();
        for (String raw : text.split("\n")) {
            if (judgment(raw) != null || raw.strip().equals(CAST_HEADER)) {
                continue;
            }
            castLine(raw, traits);
        }
        return traits;
    }

    /** {@code 이름<TAB>성별<TAB>나이대} 한 줄. 이름이 비면 버린다. 목록 밖 값은 모름이다. */
    private static void castLine(String raw, Map<String, CharacterTraits> traits) {
        String[] fields = raw.split("\t", -1);
        String name = fields[0].strip().replaceFirst("^[-*•\\d.)\\s]+", "").strip();
        if (name.isEmpty()) {
            return;
        }
        traits.putIfAbsent(name, CharacterTraits.parse(fields.length > 1 ? fields[1] : null, fields.length > 2 ? fields[2] : null));
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
