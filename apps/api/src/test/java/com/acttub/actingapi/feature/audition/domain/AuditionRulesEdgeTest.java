package com.acttub.actingapi.feature.audition.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;

import org.junit.jupiter.api.Test;

/** app.audition: 게시일도 마감일도 없는 공고는 열려 있지 않고, 출처 설정이 없으면 모으지 않는다. */
class AuditionRulesEdgeTest {
    static final LocalDate TODAY = LocalDate.of(2026, 10, 8);

    @Test void aPostingWithoutAnyDateIsNotOpen() {
        var undated = new AuditionPosting("otr", "1", null, "other", null, null, null, null, null, "https://otr.co.kr/audition/?vid=1");
        assertThat(AuditionRules.hasClosedMarker(undated)).isFalse();
        assertThat(AuditionRules.isOpen(undated, TODAY)).isFalse();
    }

    @Test void noSourceSettingMeansNoSources() {
        assertThat(AuditionRules.enabledSources(null)).isEmpty();
        assertThat(AuditionRules.guessCategory("영화 단역 모집")).isEqualTo("other");
    }
}
