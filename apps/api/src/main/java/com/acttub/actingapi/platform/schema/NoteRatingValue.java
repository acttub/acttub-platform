package com.acttub.actingapi.platform.schema;

import jakarta.persistence.Converter;

/**
 * {@code note_ratings.rating} 의 값 — 연습 노트에 남긴 "도움 됐어요·아쉬웠어요" (practice.note, V22).
 *
 * <p>값 이름은 DB CHECK 값이자 API 값이다. 한쪽만 고치면 {@code ValueCheckCatalogIT} 가 잡는다.
 */
public enum NoteRatingValue implements PgEnum {
    /** 도움 됐어요. */
    HELPFUL("helpful"),
    /** 아쉬웠어요. */
    NOT_HELPFUL("not_helpful");

    private final String dbValue;

    NoteRatingValue(String dbValue) {
        this.dbValue = dbValue;
    }

    @Override
    public String dbValue() {
        return dbValue;
    }

    @Converter(autoApply = false)
    public static class JpaConverter extends PgEnumConverter<NoteRatingValue> {
        public JpaConverter() {
            super(NoteRatingValue.class);
        }
    }
}
