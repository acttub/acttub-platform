package com.acttub.actingapi.feature.reading.app;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** 앱 speakableText·speechTextOf 와 같은 글을 만든다 — 다르면 미리 만든 음성을 못 찾는다(SOMA-949). */
class VoiceTextTest {
    @Test
    void dropsDirectionsAndQuotesLikeTheApp() {
        assertThat(VoiceText.speakable("(웃으며) \"그래, 알았어.\"  [작게] 가자【속삭임】")).isEqualTo("그래, 알았어. 가자");
        assertThat(VoiceText.speakable("‘진짜’ “괜찮아”（한숨）")).isEqualTo("진짜 괜찮아");
    }

    @Test
    void usesSpeechWhenPresentAndTextOtherwise() {
        assertThat(VoiceText.spoken("원문 (지문)", null)).isEqualTo("원문");
        assertThat(VoiceText.spoken("원문", "  ")).isEqualTo("원문");
        assertThat(VoiceText.spoken("원문", "읽을 글")).isEqualTo("읽을 글");
        // 말 표시가 맨 앞이 아니면 한 번에 읽는다 — 표시는 띄어쓰기로 바뀐다.
        assertThat(VoiceText.spoken("x", "안녕 \u27E6en\u27E7hello")).isEqualTo("안녕 hello");
    }

    @Test
    void linesSplitIntoLanguagePartsAreNotSpokenAtOnce() {
        assertThat(VoiceText.spoken("x", "\u27E6en\u27E7hello \u27E6ko\u27E7안녕")).isNull();
    }
}
