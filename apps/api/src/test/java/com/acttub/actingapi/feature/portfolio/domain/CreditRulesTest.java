package com.acttub.actingapi.feature.portfolio.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class CreditRulesTest {

    @Test
    @DisplayName("account.portfolio: 경력의 연도는 1900년부터 내년까지다 — 내년은 한국 시간의 오늘에서 센다")
    void yearRunsFrom1900ThroughNextYear() {
        LocalDate lastDayOfYear = LocalDate.of(2026, 12, 31);

        assertThat(CreditRules.yearAllowed(1899, lastDayOfYear)).isFalse();
        assertThat(CreditRules.yearAllowed(1900, lastDayOfYear)).isTrue();
        assertThat(CreditRules.yearAllowed(2027, lastDayOfYear)).isTrue();
        assertThat(CreditRules.yearAllowed(2028, lastDayOfYear)).isFalse();
        assertThat(CreditRules.yearAllowed(2028, lastDayOfYear.plusDays(1))).as("해가 바뀌면 내년도 바뀐다").isTrue();
    }

    @Test
    @DisplayName("account.portfolio: 길이는 글자(code point)로 센다 — 이모지 하나는 한 글자다")
    void lengthCountsCodePoints() {
        assertThat(CreditRules.length("배우🎭")).isEqualTo(3);
    }
}
