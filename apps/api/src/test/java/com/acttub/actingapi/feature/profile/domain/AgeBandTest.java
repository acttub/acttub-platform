package com.acttub.actingapi.feature.profile.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class AgeBandTest {
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 2);

    @Test
    @DisplayName("account.withdraw: 생년월일은 5세 단위 연령대의 아래 끝으로 뭉갠다 — 생일 전날과 당일이 갈린다")
    void birthDateBecomesTheLowerEndOfAFiveYearBand() {
        assertThat(AgeBand.of(LocalDate.of(2001, 3, 14), TODAY)).isEqualTo(25);
        assertThat(AgeBand.of(LocalDate.of(1996, 10, 3), TODAY)).as("내일이 서른 번째 생일").isEqualTo(25);
        assertThat(AgeBand.of(LocalDate.of(1996, 10, 2), TODAY)).as("오늘이 서른 번째 생일").isEqualTo(30);
        assertThat(AgeBand.of(LocalDate.of(2012, 1, 1), TODAY)).isEqualTo(10);
    }
}
