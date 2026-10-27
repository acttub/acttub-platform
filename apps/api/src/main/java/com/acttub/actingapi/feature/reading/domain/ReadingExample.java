package com.acttub.actingapi.feature.reading.domain;

import java.util.ArrayList;
import java.util.List;

/**
 * 서버에 미리 나눠 둔 예시 대본 한 편 — {@code reading_examples} 한 행 (reading.script 「예시 대본」, V61).
 *
 * <p>고르면 {@link #draft()} 를 그 사람의 대본으로 복사한다 — 모델·script_split 동의·하루 한도 없이. 원문은 앱 내장 목록과 글자
 * 그대로 같아 같은 글(해시) 판정이 옛 길(글 올리기)과 이어진다.
 *
 * @param characters 배역 이름. 줄의 {@code character} 가 이 자리(0부터)를 가리킨다
 * @param lines 줄 순서대로. ordinal 은 자리 + 1 이다
 * @param audio 미리 만든 상대역 음성(V62). 없으면 {@code null}
 * @param category 분류(V71). {@code general}(기본) 또는 {@code exam}(입시 대사)
 */
public record ReadingExample(String id, String title, String summary, String rawText, List<String> characters, List<Line> lines,
        ReadingExampleAudio audio, String category) {

    public static final String GENERAL = "general";
    public static final String EXAM = "exam";

    /** 목록 미리보기 줄 수. */
    public static final int PREVIEW_LINES = 5;

    public ReadingExample {
        characters = List.copyOf(characters);
        lines = List.copyOf(lines);
        if (category == null) category = GENERAL;
    }

    /** 분류가 기본({@code general})인 예시. */
    public ReadingExample(String id, String title, String summary, String rawText, List<String> characters, List<Line> lines,
            ReadingExampleAudio audio) {
        this(id, title, summary, rawText, characters, lines, audio, GENERAL);
    }

    /** 미리 만든 음성이 없는 예시. */
    public ReadingExample(String id, String title, String summary, String rawText, List<String> characters, List<Line> lines) {
        this(id, title, summary, rawText, characters, lines, null);
    }

    /** 대본 저장에 넘길 모양. 입력 경로는 {@code sample}, 제목은 예시 제목. */
    public ScriptDraft draft() {
        List<ScriptDraft.Line> out = new ArrayList<>();
        for (Line line : lines) {
            out.add(new ScriptDraft.Line(out.size() + 1, line.kind(), line.character(), line.text()));
        }
        return new ScriptDraft(title, rawText, "sample", characters, out);
    }

    public int dialogueCount() {
        return (int) lines.stream().filter(line -> "dialogue".equals(line.kind())).count();
    }

    /** 앞 {@value #PREVIEW_LINES}줄. 지문·장면은 화자가 없다. */
    public List<Preview> preview() {
        return lines.stream().limit(PREVIEW_LINES)
                .map(line -> new Preview(line.character() == null ? null : characters.get(line.character()), line.text()))
                .toList();
    }

    /** @param kind {@code dialogue}·{@code direction}·{@code scene} @param character 대사면 배역 자리, 아니면 {@code null} */
    public record Line(String kind, Integer character, String text) {
    }

    public record Preview(String speaker, String text) {
    }
}
