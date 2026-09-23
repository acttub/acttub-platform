package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code practice_feedback.screen} 의 값 — 이탈 설문이 뜬 화면 (practice.feedback).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum FeedbackScreen implements PgEnum {
    /** 코치 대화 화면. */
    COACH("coach"),
    /** 연습 노트(결과) 화면. */
    REPORT("report");

    private final String dbValue;

    FeedbackScreen(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<FeedbackScreen> {
        public JpaConverter() {
            super(FeedbackScreen.class);
        }
    }
}
