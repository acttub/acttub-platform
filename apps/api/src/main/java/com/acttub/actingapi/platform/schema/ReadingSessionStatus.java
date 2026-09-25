package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code reading_sessions.status} 의 값 — 리딩 회차의 상태 (reading.session).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum ReadingSessionStatus implements PgEnum {
    /** 진행 중 — 대본당 하나다. */
    IN_PROGRESS("in_progress"),
    /** 구간의 끝 대사를 지났다. */
    COMPLETED("completed"),
    /** 새 회차가 닫았다. */
    STOPPED("stopped");

    private final String dbValue;

    ReadingSessionStatus(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<ReadingSessionStatus> {
        public JpaConverter() {
            super(ReadingSessionStatus.class);
        }
    }
}
