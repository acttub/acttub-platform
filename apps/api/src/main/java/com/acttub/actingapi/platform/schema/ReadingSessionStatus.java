package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code reading_sessions.status} 의 값 — 리딩 회차의 상태 (reading.session).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum ReadingSessionStatus implements PgEnum {
    /** 진행 중 — 한 대본에 여럿일 수 있다. */
    IN_PROGRESS("in_progress"),
    /** 기기가 진행 저장에 complete=true 를 보냈다. 서버는 위치를 보지 않는다 — 언제 보내는지는 reading.session 「규칙·제약」. */
    COMPLETED("completed");

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
