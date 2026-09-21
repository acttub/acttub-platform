package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code practice_feedback.trigger} 의 값 — 설문을 부른 이탈 방식 (practice.feedback).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum FeedbackTrigger implements PgEnum {
    /** 닫기 버튼. */
    X("x"),
    /** 화면을 떠남. */
    LEAVE("leave"),
    /** 뒤로 가기. */
    BACK("back");

    private final String dbValue;

    FeedbackTrigger(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<FeedbackTrigger> {
        public JpaConverter() {
            super(FeedbackTrigger.class);
        }
    }
}
