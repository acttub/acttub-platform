package com.acttub.actingapi.feature.profile.adapter.web;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;

import com.acttub.actingapi.feature.profile.app.ProfileService;
import com.acttub.actingapi.platform.web.ApiValidationException;

/** {@code PUT /v2/me/exam-date} 의 날짜 검사. 한국 날짜 기준 오늘~오늘+400일만 받는다. */
final class ExamDateInput {
    private ExamDateInput() {}

    /** @param today 한국 날짜 기준 오늘. @return 날짜, 지우려면({@code raw == null}) null */
    static LocalDate parse(String raw, LocalDate today) {
        if (raw == null) {
            return null;
        }
        LocalDate date;
        try {
            date = LocalDate.parse(raw);
        } catch (DateTimeParseException invalid) {
            throw ApiValidationException.valueError(
                    List.of("body", "exam_date"), "Value error, exam_date must be a date like 2026-12-05", raw);
        }
        if (date.isBefore(today) || date.isAfter(today.plusDays(ProfileService.EXAM_DATE_MAX_DAYS))) {
            throw ApiValidationException.valueError(
                    List.of("body", "exam_date"),
                    "Value error, exam_date must be between today and " + ProfileService.EXAM_DATE_MAX_DAYS + " days from today",
                    raw);
        }
        return date;
    }
}
