package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/** {@code practice_status_t} — {@code models.py} 의 {@code PracticeStatus}. */
public enum PracticeStatus implements PgEnum {
    CREATED("created"),
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
