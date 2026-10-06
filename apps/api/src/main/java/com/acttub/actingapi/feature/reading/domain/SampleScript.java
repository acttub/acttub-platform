package com.acttub.actingapi.feature.reading.domain;

import java.util.List;

/**
 * 앱·웹에 내장된 예시 대본 「옥상, 밤」({@code apps/mobile/lib/reading/sample.ts} 와 같은 글)과 미리 나눈 결과.
 * 들어온 글이 정리 뒤 이 글과 같으면 모델을 부르지 않는다(SOMA-593 7-2 0번) — 운영 대본 116편 중 48편이 예시였고
 * 튜토리얼이 이 글로 돈다. 경로가 아니라 글로 비교하므로 예시를 불러온 뒤 고친 글은 보통 대본처럼 나눈다.
 *
 * <p>앱의 글을 바꾸면 여기도 함께 바꾼다 — {@code SampleScriptTest} 가 줄 수·대사 수를 고정한다.
 */
public final class SampleScript {

    public static final String TITLE = "옥상, 밤";

    public static final String TEXT = """
            옥상, 밤

            (옥상 난간. 도시 불빛. 바람 소리.)

            윤서: 여기 있을 줄 알았어.
            태오: 어떻게 알았어.
            윤서: 너 힘들면 항상 높은 데로 가잖아.
            태오: (웃으며) 그런가.
            윤서: 왜 말 안 했어. 오디션 떨어진 거.
            태오: 말하면 뭐가 달라져.
            윤서: 달라지지. 나는 알잖아, 네가 그거 얼마나 준비했는지.
            태오: 그래서 더 말하기 싫었어. 네가 그걸 아니까.

            (사이. 태오가 난간에 기댄다.)

            윤서: 다음 거 언제야.
            태오: 모레.
            윤서: 그럼 오늘은 내려가자. 대본은 내가 상대역 해줄게.
            태오: 너 연기 못하잖아.
            윤서: 알아. 그래도 혼자 하는 것보단 낫지.
            태오: (한참 보다가) 고마워.
            윤서: 가자. 춥다.""";

    public static final String HASH = ScriptText.hash(TEXT);

    private static final List<String> CHARACTERS = List.of("윤서", "태오");

    private SampleScript() {
    }

    /** 정리 뒤 같은 글인가. */
    public static boolean matches(String rawText) {
        return HASH.equals(ScriptText.hash(rawText));
    }

    /** 미리 나눈 결과. 제목은 요청이 주면 그것, 없으면 「옥상, 밤」. */
    public static ScriptDraft draft(String title, String rawText, String source) {
        List<ScriptDraft.Line> lines = List.of(
                direction(1, "(옥상 난간. 도시 불빛. 바람 소리.)"),
                dialogue(2, 0, "여기 있을 줄 알았어."),
                dialogue(3, 1, "어떻게 알았어."),
                dialogue(4, 0, "너 힘들면 항상 높은 데로 가잖아."),
                dialogue(5, 1, "(웃으며) 그런가."),
                dialogue(6, 0, "왜 말 안 했어. 오디션 떨어진 거."),
                dialogue(7, 1, "말하면 뭐가 달라져."),
                dialogue(8, 0, "달라지지. 나는 알잖아, 네가 그거 얼마나 준비했는지."),
                dialogue(9, 1, "그래서 더 말하기 싫었어. 네가 그걸 아니까."),
                direction(10, "(사이. 태오가 난간에 기댄다.)"),
                dialogue(11, 0, "다음 거 언제야."),
                dialogue(12, 1, "모레."),
                dialogue(13, 0, "그럼 오늘은 내려가자. 대본은 내가 상대역 해줄게."),
                dialogue(14, 1, "너 연기 못하잖아."),
                dialogue(15, 0, "알아. 그래도 혼자 하는 것보단 낫지."),
                dialogue(16, 1, "(한참 보다가) 고마워."),
                dialogue(17, 0, "가자. 춥다."));
        return new ScriptDraft(title == null || title.isBlank() ? TITLE : title.strip(), rawText, source, CHARACTERS, lines);
    }

    private static ScriptDraft.Line dialogue(int ordinal, int character, String text) {
        return new ScriptDraft.Line(ordinal, "dialogue", character, text);
    }

    private static ScriptDraft.Line direction(int ordinal, String text) {
        return new ScriptDraft.Line(ordinal, "direction", null, text);
    }
}
