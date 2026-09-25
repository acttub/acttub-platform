package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code practices.close_reason} 의 값 — 회차가 닫힌 사유 (practice.start, practice.analyze).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum PracticeCloseReason implements PgEnum {
    /** 분석이 최종 실패했다(재시도 3회 소진·즉시 실패 분류). */
    ANALYSIS_FAILED("analysis_failed"),
    /** 배우가 "그만두기"로 분석을 취소했다. */
    CANCELLED("cancelled"),
    /** 코치 대화가 끝났다. */
    CONVERSATION_CLOSED("conversation_closed");

    private final String dbValue;

    PracticeCloseReason(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<PracticeCloseReason> {
        public JpaConverter() {
            super(PracticeCloseReason.class);
        }
    }
}
