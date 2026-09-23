package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code reading_sessions.mode} 의 값 — 리딩 회차의 방식 (reading.session).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum ReadingMode implements PgEnum {
    /** 읽어주기 — 상대 대사는 기기가 읽고 내 대사에서 멈춘다. */
    READ("read"),
    /** 암기 대조 — 내 대사를 가리고 말한 것을 원문과 대조한다. */
    QUIZ("quiz");

    private final String dbValue;

    ReadingMode(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<ReadingMode> {
        public JpaConverter() {
            super(ReadingMode.class);
        }
    }
}
