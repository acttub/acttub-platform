package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code coach_notes.format} 의 값 — 연습 노트의 형식 (practice.note).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum NoteFormat implements PgEnum {
    /** 현행 갈래. 종류는 analysis·expression 이고 원문을 함께 둔다. */
    LEGACY("legacy"),
    /** 신형. 종류는 action·observation·record_only 다. */
    V2("v2");

    private final String dbValue;

    NoteFormat(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<NoteFormat> {
        public JpaConverter() {
            super(NoteFormat.class);
        }
    }
}
