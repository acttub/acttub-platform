package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code reading_recordings.transcript_source} 의 값 — 전사가 어디서 왔는가 (reading.recording).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum TranscriptSource implements PgEnum {
    /** 기기 음성인식. */
    STT("stt"),
    /** 전사 없음 — 전사·대조가 NULL 이다. */
    NONE("none");

    private final String dbValue;

    TranscriptSource(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<TranscriptSource> {
        public JpaConverter() {
            super(TranscriptSource.class);
        }
    }
}
