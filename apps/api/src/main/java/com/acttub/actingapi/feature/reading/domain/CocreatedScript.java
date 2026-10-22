package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.List;

/**
 * 찍을 대사 같이 만들기(SOMA-721)로 모델이 쓴 대본 한 버전. 모델 답의 JSON 모양 그대로다 — 배역은 이름으로 가리킨다.
 *
 * @param design 대사보다 먼저 채운 설계도. 수정할 때 모델에 다시 준다
 * @param characters 배역. {@code mine=true} 가 배우의 배역이다
 * @param lines {@code scene}·{@code direction}·{@code dialogue}. 대사만 {@code character} 가 있다
 */
public record CocreatedScript(Design design, String title, String scene, List<Role> characters, List<Line> lines) {

    public CocreatedScript {
        characters = List.copyOf(characters);
        lines = List.copyOf(lines);
    }

    /** 설계도. 모델이 비운 칸은 빈 글이다. */
    public record Design(
            String relation,
            String incident,
            String prop,
            String myObjective,
            String otherReason,
            List<String> tactics,
            List<String> beats,
            String turnAction,
            String endingType) {

        public static final Design EMPTY = new Design("", "", "", "", "", List.of(), List.of(), "", "");

        public Design {
            tactics = List.copyOf(tactics);
            beats = List.copyOf(beats);
        }
    }

    /** @param gender {@code m}·{@code f}, @param ageBand {@code child}·{@code young}·{@code adult}·{@code senior} */
    public record Role(String name, String gender, String ageBand, boolean mine) {
    }

    public record Line(String kind, String character, String text) {
    }

    /** 배우의 배역. 없으면 {@code null}. */
    public Role mine() {
        return characters.stream().filter(Role::mine).findFirst().orElse(null);
    }

    /** 대사 글자 수 합계(공백·문장부호 포함). 분량 추정의 바탕이다. */
    public int dialogueChars() {
        return lines.stream().filter(line -> "dialogue".equals(line.kind())).mapToInt(line -> line.text().length()).sum();
    }

    /** 배우 배역의 대사 줄 수. */
    public int myLines() {
        Role mine = mine();
        if (mine == null) {
            return 0;
        }
        return (int) lines.stream()
                .filter(line -> "dialogue".equals(line.kind()) && mine.name().equals(line.character()))
                .count();
    }

    /** {@code index} 줄의 글만 바꾼 같은 대본. */
    public CocreatedScript withText(int index, String text) {
        List<Line> next = new ArrayList<>(lines);
        Line line = next.get(index);
        next.set(index, new Line(line.kind(), line.character(), text));
        return new CocreatedScript(design, title, scene, characters, next);
    }

    /**
     * 기존 대본 저장(reading.script)에 넣을 모양. 배역은 이름 대신 자리로 가리키고, 장면 줄은 맨 앞 줄만 장면으로 둔다.
     * 성별·나이대는 모델이 정한 값이다. 출처는 앱에서 만든 대본인 {@code typed} 다.
     */
    public ScriptDraft toDraft() {
        List<String> names = characters.stream().map(Role::name).toList();
        List<CharacterTraits> traits = characters.stream()
                .map(role -> CharacterTraits.parse(role.gender(), role.ageBand()))
                .toList();
        List<ScriptDraft.Line> draftLines = new ArrayList<>();
        StringBuilder raw = new StringBuilder(title).append("\n\n");
        int ordinal = 1;
        for (Line line : lines) {
            Integer index = "dialogue".equals(line.kind()) ? names.indexOf(line.character()) : null;
            draftLines.add(new ScriptDraft.Line(ordinal++, line.kind(), index, line.text()));
            raw.append(switch (line.kind()) {
                case "dialogue" -> line.character() + ": " + line.text();
                case "direction" -> "(" + line.text() + ")";
                default -> line.text();
            }).append('\n');
        }
        return new ScriptDraft(title, raw.toString().strip(), "typed", names, draftLines, traits);
    }
}
