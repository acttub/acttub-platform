package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code practice_sessions.status} 의 값 — 분석이 어디까지 갔는지다.
 *
 * <p>{@code created} 는 없다. 연습 INSERT 가 항상 {@code analyzing} 을 명시해 그 값이 될
 * 경로가 없었고(컬럼 DEFAULT 마저 발동한 적이 없다), 운영·dev 0건을 확인한 뒤 값과 DEFAULT 를
 * 함께 걷어냈다 (SOMA-462).
 */
public enum PracticeStatus implements PgEnum {
    ANALYZING("analyzing"),
    ANALYZED("analyzed"),
    FAILED("failed");

    private final String dbValue;

    PracticeStatus(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<PracticeStatus> {
        public JpaConverter() {
            super(PracticeStatus.class);
        }
    }
}
