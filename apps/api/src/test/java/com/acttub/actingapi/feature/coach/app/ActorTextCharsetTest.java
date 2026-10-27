package com.acttub.actingapi.feature.coach.app;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class ActorTextCharsetTest {

    @Test void everydayAnswersPass() {
        assertThat(ActorTextCharset.readable("옆 사람이 웃는지 궁금해서 봤어요")).isTrue();
        assertThat(ActorTextCharset.readable("ㅋㅋㅋ 잘 모르겠어요ㅠㅠ...")).isTrue();
        assertThat(ActorTextCharset.readable("I wanted to see if she smiled!")).isTrue();
        assertThat(ActorTextCharset.readable("「그만」이라고 했죠… “진짜”요? ※ 2번째 줄 → 3번째")).isTrue();
        assertThat(ActorTextCharset.readable("첫 줄\n둘째 줄")).isTrue();
        assertThat(ActorTextCharset.readable("café · 10×2 ₩3,900")).isTrue();
    }

    @Test void emojiSequencesPass() {
        assertThat(ActorTextCharset.readable("좋아요 👍🏻😂")).isTrue();
        assertThat(ActorTextCharset.readable("❤️ ❤️‍🔥 👨‍👩‍👧 🇰🇷 1️⃣ ⭐")).isTrue();
    }

    @Test void decomposedLatinIsComposedFirst() {
        assertThat(ActorTextCharset.readable("cafe\u0301")).isTrue();
    }

    @Test void stackedCombiningMarksAreRejected() {
        // 10/27 운영 코칭에 들어온 글과 같은 모양(글자마다 결합 기호를 쌓음).
        assertThat(ActorTextCharset.readable("Z\u0325\u031c\u0318\u0316\u0323\u0344\u0303\u0301\u031aa\u031c\u031d\u0349lgo...")).isFalse();
        assertThat(ActorTextCharset.readable("G\u0338\u0356\u0333\u034e\u0348\u0320cbh")).isFalse();
        assertThat(ActorTextCharset.readable("안녕\u0301")).isFalse();
    }

    @Test void invisibleAndControlCharactersAreRejected() {
        assertThat(ActorTextCharset.readable("\u200B")).isFalse();
        assertThat(ActorTextCharset.readable("네\u200B")).isFalse();
        assertThat(ActorTextCharset.readable("\u202Eabc")).isFalse();
        assertThat(ActorTextCharset.readable("a\u0007b")).isFalse();
        assertThat(ActorTextCharset.readable("\u200D")).isFalse();
        assertThat(ActorTextCharset.readable("a\uFE0F\uFE0F\uFE0F")).isFalse();
        assertThat(ActorTextCharset.readable("   ")).isFalse();
        assertThat(ActorTextCharset.readable(null)).isFalse();
    }

    @Test void otherScriptsAreRejected() {
        assertThat(ActorTextCharset.readable("漢字")).isFalse();
        assertThat(ActorTextCharset.readable("こんにちは")).isFalse();
        assertThat(ActorTextCharset.readable("привет")).isFalse();
    }
}
