package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code video_transcripts.status} 의 값 — 받아쓰기 묶음의 처리 상태 (practice.record, practice.analyze).
 *
 * <p>{@code reserved} 는 생성 예약이다 — 같은 영상의 첫 분석 둘이 동시에 시작해도 유일 제약이 하나만 통과시키고
 * 진 쪽은 그 묶음이 {@code ready} 가 되기를 기다린다. 확정된 묶음만 재사용한다.
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum TranscriptStatus implements PgEnum {
    /** 만들고 있다(예약). */
    RESERVED("reserved"),
    /** 쓸 수 있다. */
    READY("ready"),
    /** 만들지 못했다. 다음 분석이 다시 예약한다. */
    FAILED("failed");

    private final String dbValue;

    TranscriptStatus(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<TranscriptStatus> {
        public JpaConverter() {
            super(TranscriptStatus.class);
        }
    }
}
