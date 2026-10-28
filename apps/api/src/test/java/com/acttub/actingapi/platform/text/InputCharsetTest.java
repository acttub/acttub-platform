package com.acttub.actingapi.platform.text;

import static org.assertj.core.api.Assertions.assertThat;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.acttub.actingapi.platform.web.ApiException;
import org.junit.jupiter.api.Test;

class InputCharsetTest {

    @Test void everydayAnswersPass() {
        assertThat(InputCharset.readable("옆 사람이 웃는지 궁금해서 봤어요")).isTrue();
        assertThat(InputCharset.readable("ㅋㅋㅋ 잘 모르겠어요ㅠㅠ...")).isTrue();
        assertThat(InputCharset.readable("I wanted to see if she smiled!")).isTrue();
        assertThat(InputCharset.readable("「그만」이라고 했죠… “진짜”요? ※ 2번째 줄 → 3번째")).isTrue();
        assertThat(InputCharset.readable("첫 줄\n둘째 줄")).isTrue();
        assertThat(InputCharset.readable("café · 10×2 ₩3,900")).isTrue();
    }

    @Test void emojiSequencesPass() {
        assertThat(InputCharset.readable("좋아요 👍🏻😂")).isTrue();
        assertThat(InputCharset.readable("❤️ ❤️‍🔥 👨‍👩‍👧 🇰🇷 1️⃣ ⭐")).isTrue();
    }

    @Test void decomposedLatinIsComposedFirst() {
        assertThat(InputCharset.readable("cafe\u0301")).isTrue();
    }

    @Test void stackedCombiningMarksAreRejected() {
        // 10/27 운영 코칭에 들어온 글과 같은 모양(글자마다 결합 기호를 쌓음).
        assertThat(InputCharset.readable("Z\u0325\u031c\u0318\u0316\u0323\u0344\u0303\u0301\u031aa\u031c\u031d\u0349lgo...")).isFalse();
        assertThat(InputCharset.readable("G\u0338\u0356\u0333\u034e\u0348\u0320cbh")).isFalse();
        assertThat(InputCharset.readable("안녕\u0301")).isFalse();
    }

    @Test void invisibleAndControlCharactersAreRejected() {
        assertThat(InputCharset.readable("\u200B")).isFalse();
        assertThat(InputCharset.readable("네\u200B")).isFalse();
        assertThat(InputCharset.readable("\u202Eabc")).isFalse();
        assertThat(InputCharset.readable("a\u0007b")).isFalse();
        assertThat(InputCharset.readable("\u200D")).isFalse();
        assertThat(InputCharset.readable("a\uFE0F\uFE0F\uFE0F")).isFalse();
        assertThat(InputCharset.readable("   ")).isFalse();
        assertThat(InputCharset.readable(null)).isFalse();
    }

    @Test void otherScriptsAreRejected() {
        assertThat(InputCharset.readable("漢字")).isFalse();
        assertThat(InputCharset.readable("こんにちは")).isFalse();
        assertThat(InputCharset.readable("привет")).isFalse();
    }

    @Test void requireSkipsEmptyAndRejectsStacked() {
        assertThatCode(() -> InputCharset.require(null, "", "  ", "안녕")).doesNotThrowAnyException();
        assertThatThrownBy(() -> InputCharset.require("ok", "Z\u0325\u031c\u0318\u0316\u0323x"))
                .isInstanceOf(ApiException.class).hasMessageContaining("unreadable_text");
    }

    @Test void scriptRuleOnlyLimitsStacking() {
        assertThat(InputCharset.stacked("안녕하세요 こんにちは 你好 Привет café 😂 ❤️‍🔥 ‘대사’\n둘째 줄")).isFalse();
        assertThat(InputCharset.stacked("e\u0301 a\u0301\u0302")).isFalse();
        assertThat(InputCharset.stacked("Z\u0325\u031c\u0318\u0316\u0323\u0344\u0303a")).isTrue();
        assertThat(InputCharset.stacked("a\u0007b")).isTrue();
        assertThatCode(() -> InputCharset.requireNoStacking("漢字 ひらがな")).doesNotThrowAnyException();
        assertThatThrownBy(() -> InputCharset.requireNoStacking("Z\u0325\u031c\u0318\u0316\u0323x"))
                .isInstanceOf(ApiException.class);
    }
}
