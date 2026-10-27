package com.acttub.actingapi.feature.profile.adapter.web;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;

import com.acttub.actingapi.platform.web.ApiValidationException;
import org.junit.jupiter.api.Test;

/** PUT /v2/me/exam-date 의 날짜 검사: 한국 날짜 기준 오늘~오늘+400일, null 은 지우기 (SOMA-864). */
class ExamDateInputTest {
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 27);

    @Test
    void nullClearsTheDate() {
        assertThat(ExamDateInput.parse(null, TODAY)).isNull();
    }

    @Test
    void acceptsTodayThroughFourHundredDays() {
        assertThat(ExamDateInput.parse("2026-10-27", TODAY)).isEqualTo(TODAY);
        assertThat(ExamDateInput.parse(TODAY.plusDays(400).toString(), TODAY)).isEqualTo(TODAY.plusDays(400));
    }

    @Test
    void rejectsPastAndTooFar() {
        assertThatThrownBy(() -> ExamDateInput.parse("2026-10-26", TODAY)).isInstanceOf(ApiValidationException.class);
        assertThatThrownBy(() -> ExamDateInput.parse(TODAY.plusDays(401).toString(), TODAY)).isInstanceOf(ApiValidationException.class);
    }

    @Test
    void rejectsBadFormat() {
        for (String raw : new String[] {"", "2026/12/05", "20261205", "내일", "2026-02-30", "2026-12-5"}) {
            assertThatThrownBy(() -> ExamDateInput.parse(raw, TODAY)).as(raw).isInstanceOf(ApiValidationException.class);
        }
    }
}
