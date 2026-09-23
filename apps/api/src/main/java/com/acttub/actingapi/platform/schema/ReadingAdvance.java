package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code reading_sessions.advance} 의 값 — 내 차례를 넘기는 방식 (reading.session).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum ReadingAdvance implements PgEnum {
    /** 침묵 감지 — 말한 뒤 1.8초 침묵이면 넘어간다. */
    SILENCE("silence"),
    /** 버튼. */
    MANUAL("manual");

    private final String dbValue;

    ReadingAdvance(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<ReadingAdvance> {
        public JpaConverter() {
            super(ReadingAdvance.class);
        }
    }
}
