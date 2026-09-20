package com.acttub.actingapi.feature.profile.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;

import org.junit.jupiter.api.Test;

/** account.profile: 만 나이는 생일이 된 날부터 한 살 는다. 만 14세는 그날부터 받는다. */
class KoreanAgeTest {
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 2);

    @Test
    void ageTurnsOnTheBirthdayNotTheDayBefore() {
        assertThat(KoreanAge.on(LocalDate.of(2000, 10, 3), TODAY)).as("생일 전날").isEqualTo(25);
        assertThat(KoreanAge.on(LocalDate.of(2000, 10, 2), TODAY)).as("생일 당일").isEqualTo(26);
        assertThat(KoreanAge.on(LocalDate.of(2000, 10, 1), TODAY)).isEqualTo(26);
    }

    @Test
    void someoneTurningFourteenTodayIsOldEnoughAndTomorrowIsNot() {
        assertThat(KoreanAge.underMinimum(LocalDate.of(2012, 10, 2), TODAY)).isFalse();
        assertThat(KoreanAge.underMinimum(LocalDate.of(2012, 10, 3), TODAY)).isTrue();
    }

    @Test
    void leapDayBirthdaysTurnOnTheFirstOfMarchInCommonYears() {
        LocalDate leapling = LocalDate.of(2012, 2, 29);
        assertThat(KoreanAge.on(leapling, LocalDate.of(2026, 2, 28))).isEqualTo(13);
        assertThat(KoreanAge.on(leapling, LocalDate.of(2026, 3, 1))).isEqualTo(14);
    }
}
