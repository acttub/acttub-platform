package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code coach_notes.kind} 의 값 — 연습 노트의 종류 (practice.note).
 *
 * <p><b>성공·실패 표시가 아니다.</b> 앞의 둘은 기존 갈래({@link NoteFormat#LEGACY}), 뒤의 셋은 신형의 값이다.
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum NoteKind implements PgEnum {
    /** 기존 갈래: 분석 노트. */
    ANALYSIS("analysis"),
    /** 기존 갈래: 표현 노트. */
    EXPRESSION("expression"),
    /** 신형: 다음 촬영 제안이 있다. */
    ACTION("action"),
    /** 신형: 제안은 없고 초점이 남았다. */
    OBSERVATION("observation"),
    /** 신형: 초점 없이 끝났다. 제목은 NULL 이다. */
    RECORD_ONLY("record_only");

    private final String dbValue;

    NoteKind(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<NoteKind> {
        public JpaConverter() {
            super(NoteKind.class);
        }
    }
}
