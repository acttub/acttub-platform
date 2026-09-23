package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code line_memorization.status} 의 값 — 암기 표시 (reading.memorization).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum MemorizationStatus implements PgEnum {
    /** 이 대사 외웠어요. */
    MEMORIZED("memorized"),
    /** 아직 헷갈려요. */
    NOT_YET("not_yet");

    private final String dbValue;

    MemorizationStatus(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<MemorizationStatus> {
        public JpaConverter() {
            super(MemorizationStatus.class);
        }
    }
}
