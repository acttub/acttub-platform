package com.acttub.actingapi.feature.reading.app;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 앱이 고품질 목소리로 요청하는 글을 서버에서 똑같이 만든다(SOMA-949). 캐시 열쇠가 글로 정해지므로 한 글자만 달라도 미리 만든
 * 음성을 못 찾는다. 앱의 {@code speechParts}·{@code speechTextOf}(lib/reading/line-language.ts)와 {@code speakableText}
 * (lib/reading/tts/speakable.ts)를 옮겼다 — 앱을 고치면 여기도 고친다.
 */
public final class VoiceText {
    private static final Pattern PART_MARK = Pattern.compile("\u27E6([a-z]{2})\u27E7");
    private static final Pattern BRACKETS = Pattern.compile("[(（\\[【][^)）\\]】]*[)）\\]】]");
    private static final Pattern QUOTES = Pattern.compile("[\"“”'‘’]");
    private static final Pattern SPACES = Pattern.compile("\\s+", Pattern.UNICODE_CHARACTER_CLASS);

    private VoiceText() {}

    /**
     * 그 줄을 한 번에 읽을 때 앱이 보내는 글. 말 표시(⟦en⟧)로 시작해 조각마다 따로 읽는 줄이면 {@code null}.
     */
    public static String spoken(String text, String speech) {
        String raw = speech == null ? "" : speech.trim();
        Matcher mark = PART_MARK.matcher(raw);
        if (mark.find() && mark.start() == 0) return null;
        String joined = SPACES.matcher(PART_MARK.matcher(raw).replaceAll(" ")).replaceAll(" ").trim();
        return speakable(joined.isEmpty() ? (text == null ? "" : text) : joined);
    }

    /** 괄호 지문·따옴표를 뺀 본문(앱 speakableText). */
    public static String speakable(String text) {
        String noBrackets = BRACKETS.matcher(text).replaceAll(" ");
        String noQuotes = QUOTES.matcher(noBrackets).replaceAll("");
        return SPACES.matcher(noQuotes).replaceAll(" ").trim();
    }
}
