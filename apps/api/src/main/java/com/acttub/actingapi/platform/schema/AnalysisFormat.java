package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code analyses.format} 의 값 — 관찰 기록의 형식 (practice.analyze).
 *
 * <p>구형을 신형으로 위장하지 않는다. 새 회차의 기존 갈래 결과도 {@code legacy} 로 새 테이블에 쓴다.
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum AnalysisFormat implements PgEnum {
    /** {@code acttub.video_record.v1} 기록 전체. 행의 id 가 record_id 다. */
    VIDEO_RECORD_V1("video_record_v1"),
    /** 현행 ObservationPack 원문 그대로. */
    LEGACY("legacy");

    private final String dbValue;

    AnalysisFormat(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<AnalysisFormat> {
        public JpaConverter() {
            super(AnalysisFormat.class);
        }
    }
}
