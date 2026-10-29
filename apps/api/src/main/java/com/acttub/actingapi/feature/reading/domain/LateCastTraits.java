package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 성별을 모르는 배역만 그 배역의 대목으로 다시 묻는다 (reading.cast 「자동 목소리」, SOMA-937).
 *
 * <p>긴 대본의 배역 목록 호출은 원문 앞 {@link ScriptSplitRules#ROSTER_LINES} 줄만 본다. 2막에 처음 말하는 배역은 등장인물 목록에 이름만
 * 있어 성별을 모른 채 남고, 목소리는 남녀 순환에서 여자 목소리를 받았다(2026-10-28 Play 리뷰 「메카로 가는 길」 마리우스 — 단서는 418번째
 * 줄 직전 등장 지문의 「남자 목소리」였다). 그래서 배역마다 처음 나오기 직전 줄들, 첫 대사들과 바로 앞 줄, 이름이 든 지문을 모아 한 번 더
 * 묻는다. 알던 칸은 바꾸지 않고 빈 칸만 채운다.
 */
public final class LateCastTraits {

    /** 처음 말하기 직전에 함께 보낼 줄 수 — 등장 지문이 여기 든다. */
    public static final int BEFORE_FIRST = 3;
    /** 배역마다 보낼 첫 대사 수. 대사마다 바로 앞 줄(부르는 말 「형」「할머니」)도 함께 간다. */
    public static final int FIRST_LINES = 25;
    /** 배역 이름이 든 지문을 몇 줄까지 더 보내는가. */
    public static final int NAMED_DIRECTIONS = 5;
    /** 한 번에 묻는 배역 수 — 넘치면 대사가 많은 배역부터. */
    public static final int MAX_CHARACTERS = 12;

    private LateCastTraits() {
    }

    /** 다시 물을 배역의 자리 — 성별을 모르는 보통 배역(묶음 배역 제외) 가운데 대사가 많은 순서로 {@link #MAX_CHARACTERS} 개. */
    public static List<Integer> unknown(ScriptDraft draft) {
        int[] counts = new int[draft.characterNames().size()];
        for (ScriptDraft.Line line : draft.lines()) {
            if (line.characterIndex() != null) {
                counts[line.characterIndex()]++;
            }
        }
        List<Integer> out = new ArrayList<>();
        for (int i = 0; i < counts.length; i++) {
            if (counts[i] > 0 && draft.characterTraits().get(i).gender() == null && draft.characterMembers().get(i).isEmpty()) {
                out.add(i);
            }
        }
        out.sort((a, b) -> Integer.compare(counts[b], counts[a]));
        return List.copyOf(out.subList(0, Math.min(out.size(), MAX_CHARACTERS)));
    }

    /**
     * 모델에 보낼 글. 배역마다 「## 이름」 머리 아래 줄을 원래 순서로 「줄번호<TAB>화자: 대사」 또는 「줄번호<TAB>[지문] 글」로 쓴다.
     */
    public static String excerpt(ScriptDraft draft, List<Integer> characters) {
        List<ScriptDraft.Line> lines = draft.lines();
        StringBuilder out = new StringBuilder();
        for (int character : characters) {
            String name = draft.characterNames().get(character);
            Set<Integer> picked = new LinkedHashSet<>();
            int seen = 0;
            for (int i = 0; i < lines.size() && seen < FIRST_LINES; i++) {
                if (!Integer.valueOf(character).equals(lines.get(i).characterIndex())) {
                    continue;
                }
                int from = seen == 0 ? Math.max(0, i - BEFORE_FIRST) : Math.max(0, i - 1);
                for (int k = from; k <= i; k++) {
                    picked.add(k);
                }
                seen++;
            }
            int named = 0;
            for (int i = 0; i < lines.size() && named < NAMED_DIRECTIONS; i++) {
                ScriptDraft.Line line = lines.get(i);
                if (line.characterIndex() == null && !picked.contains(i) && line.text().contains(name)) {
                    picked.add(i);
                    named++;
                }
            }
            out.append("## ").append(name).append('\n');
            picked.stream().sorted().forEach(i -> out.append(format(draft, lines.get(i))).append('\n'));
            out.append('\n');
        }
        return out.toString().strip();
    }

    /** 답({@code 이름<TAB>성별<TAB>나이대})으로 빈 칸만 채운 대본. 묻지 않은 배역·이미 아는 칸은 그대로다. */
    public static ScriptDraft fill(ScriptDraft draft, List<Integer> asked, Map<String, CharacterTraits> answer) {
        List<CharacterTraits> next = new ArrayList<>(draft.characterTraits());
        boolean changed = false;
        for (int character : asked) {
            CharacterTraits found = answer.get(draft.characterNames().get(character));
            if (found == null) {
                continue;
            }
            CharacterTraits was = next.get(character);
            CharacterTraits merged = new CharacterTraits(was.gender() != null ? was.gender() : found.gender(),
                    was.ageBand() != null ? was.ageBand() : found.ageBand());
            if (!merged.equals(was)) {
                next.set(character, merged);
                changed = true;
            }
        }
        return changed ? draft.withTraits(next) : draft;
    }

    private static String format(ScriptDraft draft, ScriptDraft.Line line) {
        String body = line.characterIndex() == null
                ? "[" + ("scene".equals(line.kind()) ? "장면" : "지문") + "] " + line.text()
                : draft.characterNames().get(line.characterIndex()) + ": " + line.text();
        return line.ordinal() + "\t" + body.replace('\n', ' ');
    }
}
