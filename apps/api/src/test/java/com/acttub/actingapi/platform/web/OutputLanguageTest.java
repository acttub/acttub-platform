package com.acttub.actingapi.platform.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Locale;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.i18n.LocaleContextHolder;

class OutputLanguageTest {

    @AfterEach
    void clear() {
        LocaleContextHolder.resetLocaleContext();
    }

    @Test
    void koreanRequestKeepsThePromptUnchanged() {
        LocaleContextHolder.setLocale(Locale.KOREAN);

        assertThat(OutputLanguage.apply("지시")).isEqualTo("지시");
        assertThat(OutputLanguage.isKorean()).isTrue();
    }

    @Test
    void englishRequestAppendsTheOutputLanguageDirective() {
        LocaleContextHolder.setLocale(Locale.ENGLISH);

        String prompt = OutputLanguage.apply("지시");

        assertThat(prompt).startsWith("지시\n\n[Output language]\n");
        assertThat(prompt).contains("Write every word you send to them in English.");
        assertThat(OutputLanguage.isKorean()).isFalse();
    }

    @Test
    void outsideARequestOrWithoutALocaleTheLanguageIsKorean() {
        assertThat(OutputLanguage.current()).isEqualTo(Locale.KOREAN);

        LocaleContextHolder.setLocaleContext(() -> null);

        assertThat(OutputLanguage.current()).isEqualTo(Locale.KOREAN);
        assertThat(OutputLanguage.directive()).isEmpty();
    }

    @Test
    void localeWithoutALanguageNameFallsBackToEnglish() {
        assertThat(OutputLanguage.directiveFor(Locale.ROOT))
                .contains("Write every word you send to them in English.");
        assertThat(OutputLanguage.directiveFor(Locale.JAPANESE))
                .contains("Write every word you send to them in Japanese.");
        assertThat(OutputLanguage.directiveFor(null)).isEmpty();
    }
}
